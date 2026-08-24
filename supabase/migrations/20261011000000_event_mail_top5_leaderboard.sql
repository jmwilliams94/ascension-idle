-- World Boss and Gold Donation Event reward mail now includes a "Top 5"
-- leaderboard block (requested by the user) — every participant's reward
-- mail, not just the top 3 who get bonus tiers, now shows who the top 5
-- contributors were and their damage/donation totals, not just their own
-- placement line. Computed once per payout (not per participant) and
-- appended to the same v_message every reward-currency mail row in that
-- participant's batch already shares — MarketplacePanel's mail rendering
-- only shows entries[0].message per batch anyway, so this doesn't duplicate
-- anything new client-side, just gives that one shown message more content.
--
-- Touches all four existing payout sites (mirrors, not new): the two
-- pay-immediately paths (apply_world_boss_attack on killing blow,
-- donate_gold on threshold-crossing donation) and their window/buff-expiry
-- fallback paths (ensure_world_boss_spawn, ensure_gold_donation_pool) —
-- same reasoning as 20260908000000/20260922010000's own rewards_distributed_at
-- guard: only one of the two paths actually runs the loop per event, but
-- both need the same leaderboard text since either could be the one that
-- fires.
begin;

-- ============================================================================
-- 1. apply_world_boss_attack
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
        when 1 then 'You placed 1st in the World Boss fight!'
        when 2 then 'You placed 2nd in the World Boss fight!'
        when 3 then 'You placed 3rd in the World Boss fight!'
        else 'Thanks for fighting the World Boss!'
      end) || E'\n\n' || v_top5_text;

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
-- 2. ensure_world_boss_spawn (window-expiry fallback path)
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
  v_top5_text text;
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
      select 'Top 5:' || E'\n' || coalesce(string_agg(
        format('%s. %s — %s damage', ranked.rn, ranked.character_name, to_char(ranked.total_damage, 'FM999,999,999,999')),
        E'\n' order by ranked.rn
      ), '(no participants)')
      into v_top5_text
      from (
        select row_number() over (order by wbp.total_damage desc) as rn, c.name as character_name, wbp.total_damage
        from public.world_boss_participants wbp
        join public.characters c on c.id = wbp.character_id
        where wbp.spawn_id = v_current_spawn_id and (wbp.free_attempts_used + wbp.paid_attempts_used) > 0
        order by wbp.total_damage desc
        limit 5
      ) ranked;

      for v_participant in
        select character_id, total_damage, row_number() over (order by total_damage desc) as rn
        from public.world_boss_participants
        where spawn_id = v_current_spawn_id and (free_attempts_used + paid_attempts_used) > 0
      loop
        v_message := (case v_participant.rn
          when 1 then 'You placed 1st in the World Boss fight!'
          when 2 then 'You placed 2nd in the World Boss fight!'
          when 3 then 'You placed 3rd in the World Boss fight!'
          else 'Thanks for fighting the World Boss!'
        end) || E'\n\n' || v_top5_text;

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

-- ============================================================================
-- 3. donate_gold
-- ============================================================================
create or replace function public.donate_gold(p_character_id uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_gold bigint;
  v_pool_id uuid;
  v_status text;
  v_target_amount bigint;
  v_pool_total bigint;
  v_participant_total bigint;
  v_category text;
  v_multiplier numeric;
  v_duration_minutes integer;
  v_batch_id uuid;
  v_reward_participant record;
  v_reward record;
  v_message text;
  v_top5_text text;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- Lazy lifecycle trigger first — mirrors apply_world_boss_attack calling
  -- ensure_world_boss_spawn() before validating anything.
  perform public.ensure_gold_donation_pool();

  select account_id, gold into v_account_id, v_gold
  from public.characters where id = p_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_gold < p_amount then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'gold', v_gold);
  end if;

  select current_pool_id into v_pool_id from public.gold_donation_state where id = 1;

  select status, target_amount into v_status, v_target_amount
  from public.gold_donation_pools where id = v_pool_id for update;

  if v_status <> 'collecting' then
    return jsonb_build_object('ok', false, 'error', 'pool_not_collecting');
  end if;

  update public.characters set gold = gold - p_amount where id = p_character_id
  returning gold into v_gold;

  insert into public.gold_donation_participants (pool_id, character_id)
  values (v_pool_id, p_character_id)
  on conflict (pool_id, character_id) do nothing;

  update public.gold_donation_participants
  set total_donated = total_donated + p_amount, last_donated_at = now()
  where pool_id = v_pool_id and character_id = p_character_id
  returning total_donated into v_participant_total;

  update public.gold_donation_pools
  set total_donated = total_donated + p_amount
  where id = v_pool_id
  returning total_donated into v_pool_total;

  if v_pool_total >= v_target_amount then
    v_category := (array['exp', 'socket_unlock', 'comet', 'fallen_star', 'quality_tier'])[1 + floor(random() * 5)::int];
    v_multiplier := round((2 + random() * 3)::numeric, 2); -- x2.00-x5.00, uniform, even weighting
    v_duration_minutes := 30 + floor(random() * 31)::int; -- 30-60 inclusive, whole-minute increments

    update public.gold_donation_pools
    set status = 'active',
        buff_category = v_category,
        buff_multiplier = v_multiplier,
        buff_started_at = now(),
        buff_ends_at = now() + (v_duration_minutes || ' minutes')::interval
    where id = v_pool_id;

    -- Threshold just crossed on this donation — pay donor rewards out now.
    -- The buff itself keeps running its own 30-60 minute course independent
    -- of this payout; ensure_gold_donation_pool's active-buff-expired branch
    -- below is left as a fallback and no-ops the payout since
    -- rewards_distributed_at is already set here.
    v_batch_id := gen_random_uuid();

    select 'Top 5:' || E'\n' || coalesce(string_agg(
      format('%s. %s — %s Gold', ranked.rn, ranked.character_name, to_char(ranked.total_donated, 'FM999,999,999,999')),
      E'\n' order by ranked.rn
    ), '(no participants)')
    into v_top5_text
    from (
      select row_number() over (order by gdp.total_donated desc) as rn, c.name as character_name, gdp.total_donated
      from public.gold_donation_participants gdp
      join public.characters c on c.id = gdp.character_id
      where gdp.pool_id = v_pool_id
      order by gdp.total_donated desc
      limit 5
    ) ranked;

    for v_reward_participant in
      select character_id, total_donated, row_number() over (order by total_donated desc) as rn
      from public.gold_donation_participants
      where pool_id = v_pool_id
    loop
      v_message := (case v_reward_participant.rn
        when 1 then 'You were the top donor in the Gold Donation Event!'
        when 2 then 'You placed 2nd in the Gold Donation Event!'
        when 3 then 'You placed 3rd in the Gold Donation Event!'
        else 'Thanks for donating to the Gold Donation Event!'
      end) || E'\n\n' || v_top5_text;

      for v_reward in select * from public.gold_donation_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
      end loop;

      if v_reward_participant.rn <= 3 then
        for v_reward in
          select * from public.gold_donation_reward_for_tier(
            case v_reward_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.gold_donation_pools set rewards_distributed_at = now() where id = v_pool_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'gold_remaining', v_gold,
    'pool_total_donated', v_pool_total,
    'pool_target', v_target_amount,
    'triggered_buff', v_pool_total >= v_target_amount,
    'participant_total_donated', v_participant_total
  );
end;
$$;

revoke all on function public.donate_gold(uuid, integer) from public;
grant execute on function public.donate_gold(uuid, integer) to authenticated;

-- ============================================================================
-- 4. ensure_gold_donation_pool (active-buff-expired fallback path)
-- ============================================================================
create or replace function public.ensure_gold_donation_pool()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool_id uuid;
  v_next_pool_at timestamptz;
  v_status text;
  v_buff_ends_at timestamptz;
  v_rewards_distributed_at timestamptz;
  v_new_pool_id uuid;
  v_target bigint;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_reward record;
  v_message text;
  v_top5_text text;
begin
  -- Global mutex, same accepted-brief-lock-hold reasoning as
  -- ensure_world_boss_spawn's world_boss_state lock.
  select current_pool_id, next_pool_at into v_pool_id, v_next_pool_at
  from public.gold_donation_state where id = 1 for update;

  select status, buff_ends_at, rewards_distributed_at
  into v_status, v_buff_ends_at, v_rewards_distributed_at
  from public.gold_donation_pools where id = v_pool_id;

  if v_status = 'collecting' then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' and now() < v_buff_ends_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' then
    -- Buff window just expired under this caller's watch. Fallback payout
    -- path only — donate_gold already pays rewards out the instant the
    -- threshold is crossed, so rewards_distributed_at is normally already
    -- set by the time we get here.
    if v_rewards_distributed_at is null then
      select 'Top 5:' || E'\n' || coalesce(string_agg(
        format('%s. %s — %s Gold', ranked.rn, ranked.character_name, to_char(ranked.total_donated, 'FM999,999,999,999')),
        E'\n' order by ranked.rn
      ), '(no participants)')
      into v_top5_text
      from (
        select row_number() over (order by gdp.total_donated desc) as rn, c.name as character_name, gdp.total_donated
        from public.gold_donation_participants gdp
        join public.characters c on c.id = gdp.character_id
        where gdp.pool_id = v_pool_id
        order by gdp.total_donated desc
        limit 5
      ) ranked;

      for v_participant in
        select character_id, total_donated, row_number() over (order by total_donated desc) as rn
        from public.gold_donation_participants
        where pool_id = v_pool_id
      loop
        v_message := (case v_participant.rn
          when 1 then 'You were the top donor in the Gold Donation Event!'
          when 2 then 'You placed 2nd in the Gold Donation Event!'
          when 3 then 'You placed 3rd in the Gold Donation Event!'
          else 'Thanks for donating to the Gold Donation Event!'
        end) || E'\n\n' || v_top5_text;

        for v_reward in select * from public.gold_donation_reward_for_tier('participation') loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
        end loop;

        if v_participant.rn <= 3 then
          for v_reward in
            select * from public.gold_donation_reward_for_tier(
              case v_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
            )
          loop
            insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
            values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
          end loop;
        end if;
      end loop;
    end if;

    update public.gold_donation_pools set status = 'ended', rewards_distributed_at = coalesce(rewards_distributed_at, now()) where id = v_pool_id;
    update public.gold_donation_state set next_pool_at = now() + (interval '1 hour' * (1 + random() * 5)) where id = 1;

    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  -- status = 'ended': gap in progress, or gap just elapsed.
  if v_next_pool_at is null or now() < v_next_pool_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  -- 15M-30M, whole-million increments: 15,000,000 + (0..15) * 1,000,000.
  v_target := (15000000 + (floor(random() * 16))::bigint * 1000000);
  insert into public.gold_donation_pools (target_amount, total_donated, status)
  values (v_target, 0, 'collecting')
  returning id into v_new_pool_id;

  update public.gold_donation_state set current_pool_id = v_new_pool_id, next_pool_at = null where id = 1;

  return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_new_pool_id));
end;
$$;

revoke all on function public.ensure_gold_donation_pool() from public;
grant execute on function public.ensure_gold_donation_pool() to authenticated;

commit;
