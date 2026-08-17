-- World Boss rewards now mail out the moment the boss dies, instead of
-- waiting for the (still-running) 6-8 hour window to end. Since attacks are
-- refused once current_hp hits 0 (boss_defeated), the leaderboard/total_damage
-- tally is already final at the killing blow, so paying out then produces the
-- exact same standings as paying out at window end.
begin;

-- ============================================================================
-- 1. Grants gotcha (see CLAUDE.md): apply_world_boss_attack is a plain
--    (non-SECURITY DEFINER) function invoked via the world-boss-attack Edge
--    Function's service_role client, so it needs its own explicit grants for
--    anything it newly touches — mail (insert) and world_boss_reward_for_tier
--    (execute) were previously only ever reached through the SECURITY
--    DEFINER ensure_world_boss_spawn, which runs as its owner and needed no
--    such grants.
-- ============================================================================
grant insert on public.mail to service_role;
grant execute on function public.world_boss_reward_for_tier(text) to service_role;

-- ============================================================================
-- 2. apply_world_boss_attack: detect the killing blow and pay rewards out
--    immediately. world_boss_spawns is now locked (for update) during the
--    read so a killing blow is detected reliably even if two attacks land
--    concurrently against a low-HP boss.
-- ============================================================================
create or replace function public.apply_world_boss_attack(p_character_id uuid, p_spawn_id uuid, p_damage integer)
returns jsonb
language plpgsql
as $$
declare
  v_current_spawn_id uuid;
  v_account_id uuid;
  v_participant_id uuid;
  v_free_used integer;
  v_paid_used integer;
  v_last_attempt_at timestamptz;
  v_status text;
  v_window_ends_at timestamptz;
  v_current_hp bigint;
  v_max_hp bigint;
  v_new_hp bigint;
  v_effective_damage integer;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_cooldown_ends_at timestamptz;
  v_batch_id uuid;
  v_reward_participant record;
  v_reward record;
  v_message text;
begin
  -- Lazy lifecycle trigger — guarantees the spawn this call validates
  -- against is current before anything else runs.
  perform public.ensure_world_boss_spawn();

  select current_spawn_id into v_current_spawn_id from public.world_boss_state where id = 1;
  if v_current_spawn_id <> p_spawn_id then
    return jsonb_build_object('ok', false, 'error', 'spawn_changed');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.world_boss_participants (spawn_id, character_id)
  values (p_spawn_id, p_character_id)
  on conflict (spawn_id, character_id) do nothing;

  select id, free_attempts_used, paid_attempts_used, last_attempt_at
  into v_participant_id, v_free_used, v_paid_used, v_last_attempt_at
  from public.world_boss_participants
  where spawn_id = p_spawn_id and character_id = p_character_id
  for update;

  select status, window_ends_at, current_hp, max_hp
  into v_status, v_window_ends_at, v_current_hp, v_max_hp
  from public.world_boss_spawns where id = p_spawn_id
  for update;

  if v_status <> 'active' or now() >= v_window_ends_at then
    return jsonb_build_object('ok', false, 'error', 'window_ended');
  end if;

  if v_current_hp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'boss_defeated');
  end if;

  if v_last_attempt_at is not null and now() - v_last_attempt_at < interval '5 minutes' then
    return jsonb_build_object(
      'ok', false, 'error', 'on_cooldown', 'cooldown_ends_at', v_last_attempt_at + interval '5 minutes'
    );
  end if;

  if v_free_used < 10 then
    v_payment := 'free';
  elsif v_paid_used < 10 then
    v_payment := 'paid';
    select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
    if v_ap_balance < 2 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ap');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'no_attempts_remaining');
  end if;

  if v_payment = 'paid' then
    update public.players set ascension_points = ascension_points - 2 where id = v_account_id
    returning ascension_points into v_new_ap;
  end if;

  -- Never tally/report more than what actually took the boss's HP down —
  -- overkill on the killing blow contributes nothing further.
  v_effective_damage := least(p_damage, v_current_hp);
  v_new_hp := greatest(v_current_hp - p_damage, 0);

  update public.world_boss_participants
  set
    free_attempts_used = free_attempts_used + case when v_payment = 'free' then 1 else 0 end,
    paid_attempts_used = paid_attempts_used + case when v_payment = 'paid' then 1 else 0 end,
    total_damage = total_damage + v_effective_damage,
    last_attempt_at = now()
  where id = v_participant_id
  returning free_attempts_used, paid_attempts_used into v_free_used, v_paid_used;

  update public.world_boss_spawns
  set current_hp = v_new_hp
  where id = p_spawn_id;

  -- Killing blow: pay rewards out now instead of waiting for
  -- ensure_world_boss_spawn to notice the window expired. world_boss_spawns
  -- was locked above, and the earlier current_hp <= 0 check already refused
  -- this call unless current_hp was still > 0, so this branch runs exactly
  -- once per spawn.
  if v_new_hp <= 0 then
    v_batch_id := gen_random_uuid();

    for v_reward_participant in
      select character_id, total_damage, row_number() over (order by total_damage desc) as rn
      from public.world_boss_participants
      where spawn_id = p_spawn_id and (free_attempts_used + paid_attempts_used) > 0
    loop
      v_message := case v_reward_participant.rn
        when 1 then 'You placed 1st in the World Boss fight!'
        when 2 then 'You placed 2nd in the World Boss fight!'
        when 3 then 'You placed 3rd in the World Boss fight!'
        else 'Thanks for fighting the World Boss!'
      end;

      for v_reward in select * from public.world_boss_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
      end loop;

      if v_reward_participant.rn <= 3 then
        for v_reward in
          select * from public.world_boss_reward_for_tier(
            case v_reward_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.world_boss_spawns set rewards_distributed_at = now() where id = p_spawn_id;
  end if;

  v_cooldown_ends_at := now() + interval '5 minutes';

  return jsonb_build_object(
    'ok', true,
    'damage', v_effective_damage,
    'boss_current_hp', v_new_hp,
    'boss_max_hp', v_max_hp,
    'boss_defeated', v_new_hp <= 0,
    'free_attempts_used', v_free_used,
    'paid_attempts_used', v_paid_used,
    'ascension_points', v_new_ap,
    'cooldown_ends_at', v_cooldown_ends_at,
    'window_ends_at', v_window_ends_at,
    'payment', v_payment
  );
end;
$$;

revoke all on function public.apply_world_boss_attack(uuid, uuid, integer) from public;
grant execute on function public.apply_world_boss_attack(uuid, uuid, integer) to service_role;

-- ============================================================================
-- 3. ensure_world_boss_spawn: window-expiry branch now skips the reward
--    payout loop when rewards_distributed_at is already set (killing blow
--    already paid it out) — otherwise a boss killed mid-window would get
--    mailed rewards twice once the window later expires.
-- ============================================================================
create or replace function public.ensure_world_boss_spawn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_spawn_id uuid;
  v_next_spawn_at timestamptz;
  v_status text;
  v_window_ends_at timestamptz;
  v_max_hp bigint;
  v_rewards_distributed_at timestamptz;
  v_new_spawn_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_reward record;
  v_message text;
begin
  select current_spawn_id, next_spawn_at into v_current_spawn_id, v_next_spawn_at
  from public.world_boss_state where id = 1 for update;

  select status, window_ends_at, max_hp, rewards_distributed_at
  into v_status, v_window_ends_at, v_max_hp, v_rewards_distributed_at
  from public.world_boss_spawns where id = v_current_spawn_id;

  -- 1. Still in-window: unchanged fast path.
  if v_status = 'active' and now() < v_window_ends_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  -- 2. Window just expired under this caller: pay out rewards, unless a
  -- killing blow already paid them out early (apply_world_boss_attack sets
  -- rewards_distributed_at the moment the boss dies) — then just close out.
  if v_status = 'active' then
    if v_rewards_distributed_at is null then
      for v_participant in
        select character_id, total_damage, row_number() over (order by total_damage desc) as rn
        from public.world_boss_participants
        where spawn_id = v_current_spawn_id and (free_attempts_used + paid_attempts_used) > 0
      loop
        v_message := case v_participant.rn
          when 1 then 'You placed 1st in the World Boss fight!'
          when 2 then 'You placed 2nd in the World Boss fight!'
          when 3 then 'You placed 3rd in the World Boss fight!'
          else 'Thanks for fighting the World Boss!'
        end;

        for v_reward in select * from public.world_boss_reward_for_tier('participation') loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
        end loop;

        if v_participant.rn <= 3 then
          for v_reward in
            select * from public.world_boss_reward_for_tier(
              case v_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
            )
          loop
            insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
            values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
          end loop;
        end if;
      end loop;
    end if;

    update public.world_boss_spawns set status = 'ended', rewards_distributed_at = coalesce(rewards_distributed_at, now()) where id = v_current_spawn_id;
    update public.world_boss_state set next_spawn_at = now() + (interval '1 hour' * (1 + random() * 5)) where id = 1;

    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  -- 3. status = 'ended': gap in progress, or gap just elapsed.
  if v_next_spawn_at is null or now() < v_next_spawn_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  -- Gap elapsed: roll the next spawn, same as the old unconditional insert.
  v_max_hp := 50000;
  insert into public.world_boss_spawns (max_hp, current_hp, window_started_at, window_ends_at)
  values (v_max_hp, v_max_hp, now(), now() + (interval '1 hour' * (6 + random() * 2)))
  returning id into v_new_spawn_id;

  update public.world_boss_state set current_spawn_id = v_new_spawn_id, next_spawn_at = null where id = 1;

  return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_new_spawn_id));
end;
$$;

revoke all on function public.ensure_world_boss_spawn() from public;
grant execute on function public.ensure_world_boss_spawn() to authenticated;
grant execute on function public.ensure_world_boss_spawn() to service_role;

commit;
