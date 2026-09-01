-- Zone Boss account-wide exclusivity (requested by the user) — the 34%
-- per-character damage cap (20261114000000) was meant to force a kill to
-- need 3+ distinct characters, but nothing stopped one account's own 3+
-- characters from doing all of that damage themselves, capturing up to the
-- full proportional reward pool solo. Fix: once any character has logged a
-- real attempt (free or paid) against a spawn, no other character on the
-- same account may attack that same spawn — same-signature
-- create-or-replace over apply_world_boss_attack (20261114000000), checked
-- right after v_account_id is resolved so a blocked character never even
-- gets a zero-attempt world_boss_participants row inserted.
begin;

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
  v_total_damage_so_far bigint;
  v_last_attempt_at timestamptz;
  v_status text;
  v_window_ends_at timestamptz;
  v_current_hp bigint;
  v_max_hp bigint;
  v_new_hp bigint;
  v_boss_id text;
  v_boss_display_name text;
  v_cap bigint;
  v_remaining_headroom bigint;
  v_effective_damage integer;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_cooldown_ends_at timestamptz;
  v_batch_id uuid;
  v_reward_participant record;
  v_reward record;
  v_message text;
  v_top5_text text;
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

  -- Account-wide exclusivity: if a different character on this same account
  -- has already made a real attempt against this spawn, refuse outright —
  -- checked before the participant row is created so a blocked character
  -- never gets a stray zero-attempt row for this spawn.
  if exists (
    select 1
    from public.world_boss_participants wbp
    join public.characters c on c.id = wbp.character_id
    where wbp.spawn_id = p_spawn_id
      and c.account_id = v_account_id
      and wbp.character_id <> p_character_id
      and (wbp.free_attempts_used + wbp.paid_attempts_used) > 0
  ) then
    return jsonb_build_object('ok', false, 'error', 'other_character_active');
  end if;

  insert into public.world_boss_participants (spawn_id, character_id)
  values (p_spawn_id, p_character_id)
  on conflict (spawn_id, character_id) do nothing;

  select id, free_attempts_used, paid_attempts_used, last_attempt_at, total_damage
  into v_participant_id, v_free_used, v_paid_used, v_last_attempt_at, v_total_damage_so_far
  from public.world_boss_participants
  where spawn_id = p_spawn_id and character_id = p_character_id
  for update;

  select status, window_ends_at, current_hp, max_hp, boss_id
  into v_status, v_window_ends_at, v_current_hp, v_max_hp, v_boss_id
  from public.world_boss_spawns where id = p_spawn_id
  for update;

  if v_status <> 'active' or now() >= v_window_ends_at then
    return jsonb_build_object('ok', false, 'error', 'window_ended');
  end if;

  if v_current_hp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'boss_defeated');
  end if;

  -- Per-character contribution cap — checked before the cooldown/attempt
  -- gating below, since "you've already dealt your max to this boss" is a
  -- harder stop than "wait a bit and try again." Refused outright, no
  -- attempt/AP spent.
  v_cap := round(v_max_hp * 0.34);
  v_remaining_headroom := greatest(v_cap - v_total_damage_so_far, 0);
  if v_remaining_headroom <= 0 then
    return jsonb_build_object('ok', false, 'error', 'damage_cap_reached');
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

  -- Credited damage is clamped three ways: never more than what actually
  -- took the boss's HP down (overkill), never more than this character's
  -- own remaining headroom under the 34% cap, and obviously never more than
  -- the raw hit itself. This same clamped value is what reduces the boss's
  -- current_hp below — a raw overpowered hit cannot bypass the cap by
  -- damaging current_hp directly while only the tally gets clamped.
  v_effective_damage := least(p_damage, v_current_hp, v_remaining_headroom);
  v_new_hp := greatest(v_current_hp - v_effective_damage, 0);

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

    select display_name into v_boss_display_name from public.zone_boss_catalog() where boss_id = v_boss_id;
    v_boss_display_name := coalesce(v_boss_display_name, 'Zone Boss');

    select 'Top 5:' || E'\n' || coalesce(string_agg(
      format('%s. %s — %s damage', ranked.rn, ranked.character_name, to_char(ranked.total_damage, 'FM999,999,999,999')),
      E'\n' order by ranked.rn
    ), '(no participants)')
    into v_top5_text
    from (
      select row_number() over (order by wbp.total_damage desc) as rn, c.name as character_name, wbp.total_damage
      from public.world_boss_participants wbp
      join public.characters c on c.id = wbp.character_id
      where wbp.spawn_id = p_spawn_id and (wbp.free_attempts_used + wbp.paid_attempts_used) > 0
      order by wbp.total_damage desc
      limit 5
    ) ranked;

    for v_reward_participant in
      select character_id, total_damage, row_number() over (order by total_damage desc) as rn
      from public.world_boss_participants
      where spawn_id = p_spawn_id and (free_attempts_used + paid_attempts_used) > 0
    loop
      v_message := (case v_reward_participant.rn
        when 1 then 'You placed 1st in the ' || v_boss_display_name || ' fight!'
        when 2 then 'You placed 2nd in the ' || v_boss_display_name || ' fight!'
        when 3 then 'You placed 3rd in the ' || v_boss_display_name || ' fight!'
        else 'Thanks for fighting ' || v_boss_display_name || '!'
      end) || E'\n\n' || v_top5_text;

      for v_reward in select * from public.world_boss_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
      end loop;

      if v_reward_participant.rn <= 3 then
        for v_reward in
          select * from public.world_boss_reward_for_tier(
            case v_reward_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
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

commit;
