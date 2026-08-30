-- Zone Boss proportional rewards (2026-11-15, requested by the user) —
-- replaces the fixed participation/3rd/2nd/1st tier system with per-zone
-- reward POOLS split proportionally by each character's share of the
-- spawn's total damage dealt, plus a small flat participation reward on top
-- for anyone who made ≥1 attempt (unchanged: 1 Lottery Ticket).
--
-- Rationale (from the user): the strongest character was "constantly
-- locking in 1st place" and taking the lion's share of rewards under the
-- fixed-tier system, especially now that the 34% per-character damage cap
-- (previous migration) guarantees multiple contributors per kill — a
-- proportional split rewards everyone in line with what they actually did,
-- rather than a fixed 1st/2nd/3rd cliff.
--
-- Currency scope: Lottery Ticket, Fallen Star, Comet Scroll. Comet Box is
-- DROPPED from Zone Boss rewards entirely (user's call — "way too many
-- comets" for this context); its old 1st-place slot is replaced by a larger
-- Comet Scroll pool share instead. gold_donation_reward_for_tier and the
-- Gold Donation Event payout path are UNTOUCHED — this migration only
-- touches Zone Boss (apply_world_boss_attack / ensure_world_boss_spawn).
--
-- Pool sizing: each of the 3 currencies gets its own zone-scaled total pool,
-- computed once at spawn-roll time from the boss's home zone's top level and
-- stored on the spawn row (same "compute once, store on the row" pattern as
-- max_hp/physical_defense/magic_defense) — same exponential-curve shape as
-- max_hp: round(low * (high/low)^((L-1)/129)). Anchors: Lottery Ticket
-- 10->40, Fallen Star 2->12, Comet Scroll 2->10 (the 10 lottery-ticket low
-- anchor matches the user's own example number). All three, like every
-- other Zone Boss balance number, are a first pass pending real tuning.
--
-- world_boss_reward_for_tier is left in place but now unused by Zone Boss
-- (not dropped — harmless, and Gold Donation's own gold_donation_reward_for_tier
-- is a fully independent function, never called through this one).
begin;

alter table public.world_boss_spawns add column reward_pool jsonb not null default '{}'::jsonb;

-- ============================================================================
-- zone_boss_reward_pool_for_level — the one place the 3 pool-size formulas
-- live. Called once per spawn roll (ensure_world_boss_spawn), result stored
-- on the row — apply_world_boss_attack/ensure_world_boss_spawn's own payout
-- branches read it back off the spawn row, no second copy of the formula.
-- ============================================================================
create or replace function public.zone_boss_reward_pool_for_level(p_level integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'lottery_ticket', round(10 * power(40.0 / 10.0, (p_level - 1) / 129.0))::int,
    'fallen_star', round(2 * power(12.0 / 2.0, (p_level - 1) / 129.0))::int,
    'comet_scroll', round(2 * power(10.0 / 2.0, (p_level - 1) / 129.0))::int
  );
$$;

revoke all on function public.zone_boss_reward_pool_for_level(integer) from public;

-- ============================================================================
-- ensure_world_boss_spawn — full body from the damage-cap migration
-- (20261114000000), with two changes: (1) the boss-roll branch now also
-- computes and stores reward_pool; (2) the window-expiry payout branch now
-- distributes each pool currency proportionally by total_damage share
-- instead of the old participation/3rd/2nd/1st tier loop.
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
  v_last_boss_id text;
  v_status text;
  v_window_ends_at timestamptz;
  v_max_hp bigint;
  v_rewards_distributed_at timestamptz;
  v_ending_boss_id text;
  v_boss_display_name text;
  v_reward_pool jsonb;
  v_total_all_damage bigint;
  v_pct numeric;
  v_pool_row record;
  v_share integer;
  v_new_spawn_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_message text;
  v_top5_text text;
  v_boss_id text;
  v_zone_top_level integer;
  v_defense_profile text;
  v_base_defense integer;
  v_physical_defense integer;
  v_magic_defense integer;
begin
  select current_spawn_id, next_spawn_at, last_boss_id
  into v_current_spawn_id, v_next_spawn_at, v_last_boss_id
  from public.world_boss_state where id = 1 for update;

  select status, window_ends_at, max_hp, rewards_distributed_at, boss_id, reward_pool
  into v_status, v_window_ends_at, v_max_hp, v_rewards_distributed_at, v_ending_boss_id, v_reward_pool
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
      select display_name into v_boss_display_name from public.zone_boss_catalog() where boss_id = v_ending_boss_id;
      v_boss_display_name := coalesce(v_boss_display_name, 'Zone Boss');

      select coalesce(sum(total_damage), 0) into v_total_all_damage
      from public.world_boss_participants
      where spawn_id = v_current_spawn_id and (free_attempts_used + paid_attempts_used) > 0;

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
        v_pct := case when v_total_all_damage > 0 then v_participant.total_damage::numeric / v_total_all_damage else 0 end;
        v_message := 'You dealt ' || to_char(v_participant.total_damage, 'FM999,999,999,999') || ' damage (' ||
          round(v_pct * 100) || '% of the total) in the ' || v_boss_display_name || ' fight!' || E'\n\n' || v_top5_text;

        -- Flat participation reward, unchanged: 1 Lottery Ticket for anyone
        -- who made at least one attempt, regardless of contribution size.
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_participant.character_id, 'lottery_ticket', 1, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);

        -- Proportional share of each pool currency.
        for v_pool_row in select key as currency_type, value::int as pool_amount from jsonb_each_text(v_reward_pool) loop
          v_share := round(v_pool_row.pool_amount * v_pct);
          if v_share > 0 then
            insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
            values (v_participant.character_id, v_pool_row.currency_type, v_share, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
          end if;
        end loop;
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

  -- Gap elapsed: pick the next boss (never the one that just ended), derive
  -- its stats + reward pool from its home zone's top level, and roll the
  -- spawn. See the zone_boss_rotation migration for the HP/defense formula
  -- rationale; zone_boss_reward_pool_for_level above for the pool rationale.
  select boss_id, zone_top_level, defense_profile
  into v_boss_id, v_zone_top_level, v_defense_profile
  from public.zone_boss_catalog()
  where boss_id <> coalesce(v_last_boss_id, '')
  order by random()
  limit 1;

  v_max_hp := round(2000 * power(50000.0 / 2000.0, (v_zone_top_level - 1) / 129.0))::bigint;
  v_base_defense := round(v_zone_top_level * 1.5)::integer;
  if v_defense_profile = 'physical' then
    v_physical_defense := round(v_base_defense * 3.5)::integer;
    v_magic_defense := round(v_base_defense * 1.3)::integer;
  else
    v_magic_defense := round(v_base_defense * 3.5)::integer;
    v_physical_defense := round(v_base_defense * 1.3)::integer;
  end if;
  v_reward_pool := public.zone_boss_reward_pool_for_level(v_zone_top_level);

  insert into public.world_boss_spawns
    (boss_id, max_hp, current_hp, physical_defense, magic_defense, reward_pool, window_started_at, window_ends_at)
  values
    (v_boss_id, v_max_hp, v_max_hp, v_physical_defense, v_magic_defense, v_reward_pool, now(), now() + (interval '1 hour' * (6 + random() * 2)))
  returning id into v_new_spawn_id;

  update public.world_boss_state
  set current_spawn_id = v_new_spawn_id, next_spawn_at = null, last_boss_id = v_boss_id
  where id = 1;

  return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_new_spawn_id));
end;
$$;

revoke all on function public.ensure_world_boss_spawn() from public;
grant execute on function public.ensure_world_boss_spawn() to authenticated;
grant execute on function public.ensure_world_boss_spawn() to service_role;

-- ============================================================================
-- apply_world_boss_attack — full body from the damage-cap migration
-- (20261114000000), with the same proportional-payout rewrite applied to
-- its killing-blow branch. Damage/cap logic above the payout branch is
-- completely unchanged.
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
  v_total_damage_so_far bigint;
  v_last_attempt_at timestamptz;
  v_status text;
  v_window_ends_at timestamptz;
  v_current_hp bigint;
  v_max_hp bigint;
  v_new_hp bigint;
  v_boss_id text;
  v_boss_display_name text;
  v_reward_pool jsonb;
  v_cap bigint;
  v_remaining_headroom bigint;
  v_effective_damage integer;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_cooldown_ends_at timestamptz;
  v_batch_id uuid;
  v_reward_participant record;
  v_total_all_damage bigint;
  v_pct numeric;
  v_pool_row record;
  v_share integer;
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

  select id, free_attempts_used, paid_attempts_used, last_attempt_at, total_damage
  into v_participant_id, v_free_used, v_paid_used, v_last_attempt_at, v_total_damage_so_far
  from public.world_boss_participants
  where spawn_id = p_spawn_id and character_id = p_character_id
  for update;

  select status, window_ends_at, current_hp, max_hp, boss_id, reward_pool
  into v_status, v_window_ends_at, v_current_hp, v_max_hp, v_boss_id, v_reward_pool
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

    select coalesce(sum(total_damage), 0) into v_total_all_damage
    from public.world_boss_participants
    where spawn_id = p_spawn_id and (free_attempts_used + paid_attempts_used) > 0;

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
      v_pct := case when v_total_all_damage > 0 then v_reward_participant.total_damage::numeric / v_total_all_damage else 0 end;
      v_message := 'You dealt ' || to_char(v_reward_participant.total_damage, 'FM999,999,999,999') || ' damage (' ||
        round(v_pct * 100) || '% of the total) in the ' || v_boss_display_name || ' fight!' || E'\n\n' || v_top5_text;

      insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
      values (v_reward_participant.character_id, 'lottery_ticket', 1, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);

      for v_pool_row in select key as currency_type, value::int as pool_amount from jsonb_each_text(v_reward_pool) loop
        v_share := round(v_pool_row.pool_amount * v_pct);
        if v_share > 0 then
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_reward_participant.character_id, v_pool_row.currency_type, v_share, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
        end if;
      end loop;
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
