-- Zone Boss: when a spawn's window expires with the boss still alive, the
-- reward pool used to pay out only each participant's raw
-- total_damage/max_hp share, then simply VOID whatever percentage nobody
-- damaged (see 20261116000000's header) — e.g. a lone attacker capped at
-- the 34% damage ceiling got 34% of the pool and the other 66% went to no
-- one. Requested by the user: scale everyone's share up so the full pool is
-- still handed out whenever real contributors exist, while still never
-- letting any single character's PAYOUT exceed 34% (only the payout share,
-- not the damage-dealt % shown in the reward message, which still reflects
-- real damage). This does NOT touch the killing-blow payout branch in
-- apply_world_boss_attack — a real kill already sums participants' raw
-- shares to ~100% by construction (the boss's HP was fully accounted for),
-- so there's nothing to redistribute there.
--
-- Implementation: a capped water-fill over the participant list, sorted by
-- damage descending (same tiebreaker as everywhere else, last_attempt_at
-- asc). Repeatedly: whoever's raw share, scaled up to fill the currently
-- remaining budget among currently-uncapped participants, would exceed 34%
-- gets locked at exactly 34% and removed from the pool of participants still
-- being scaled; the leftover budget then re-splits across whoever's left.
-- Repeats until no one newly exceeds the cap, then the remaining budget is
-- split proportionally to raw share among the still-uncapped participants.
-- If there are too few real contributors to reach 100% even with everyone
-- capped at 34% (e.g. only 1-2 people ever attacked), the unreachable
-- remainder is still voided, same as before — there's no one left to pay it
-- to.
--
-- Full body otherwise unchanged from 20261214020000 (magic_defense baseline
-- fix) — only the reward-payout loop inside the window-expiry branch
-- changes.
begin;

create or replace function public.ensure_world_boss_spawn()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_pool_row record;
  v_share integer;
  v_new_spawn_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_message text;
  v_top5_text text;
  v_boss_id text;
  v_zone_top_level integer;
  v_defense_profile text;
  v_base_defense integer;
  v_magic_base_defense integer;
  v_physical_defense integer;
  v_magic_defense integer;
  v_char_ids uuid[];
  v_total_damage bigint[];
  v_raw_pct numeric[];
  v_share_pct numeric[];
  v_capped boolean[];
  v_n integer;
  v_remaining_budget numeric;
  v_remaining_weight numeric;
  v_any_capped boolean;
  v_cap constant numeric := 0.34;
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

      select 'Top 5:' || E'\n' || coalesce(string_agg(
        format('%s. %s — %s damage', ranked.rn, ranked.character_name, to_char(ranked.total_damage, 'FM999,999,999,999')),
        E'\n' order by ranked.rn
      ), '(no participants)')
      into v_top5_text
      from (
        select row_number() over (order by wbp.total_damage desc, wbp.last_attempt_at asc) as rn, c.name as character_name, wbp.total_damage
        from public.world_boss_participants wbp
        join public.characters c on c.id = wbp.character_id
        where wbp.spawn_id = v_current_spawn_id and (wbp.free_attempts_used + wbp.paid_attempts_used) > 0
        order by wbp.total_damage desc, wbp.last_attempt_at asc
        limit 5
      ) ranked;

      -- Gather every real contributor, ranked the same way the leaderboard
      -- and tiebreakers already are, into plain arrays — a water-fill needs
      -- to revisit "who's still uncapped" repeatedly, which is far simpler
      -- to express as a plpgsql loop over arrays than as a recursive query.
      select array_agg(character_id order by total_damage desc, last_attempt_at asc),
             array_agg(total_damage order by total_damage desc, last_attempt_at asc)
      into v_char_ids, v_total_damage
      from public.world_boss_participants
      where spawn_id = v_current_spawn_id and (free_attempts_used + paid_attempts_used) > 0;

      v_n := coalesce(array_length(v_char_ids, 1), 0);
      v_raw_pct := array_fill(0::numeric, array[v_n]);
      v_share_pct := array_fill(0::numeric, array[v_n]);
      v_capped := array_fill(false, array[v_n]);
      for i in 1..v_n loop
        v_raw_pct[i] := case when v_max_hp > 0 then v_total_damage[i]::numeric / v_max_hp else 0 end;
      end loop;

      -- Water-fill: each round, cap anyone whose raw share — scaled up to
      -- fill the budget still available among the still-uncapped — would
      -- exceed 34%, then re-derive the budget/weight and try again. Stops
      -- once a round caps no one new (bounded by v_n rounds).
      loop
        v_remaining_budget := 1.0;
        v_remaining_weight := 0;
        for i in 1..v_n loop
          if v_capped[i] then
            v_remaining_budget := v_remaining_budget - v_share_pct[i];
          else
            v_remaining_weight := v_remaining_weight + v_raw_pct[i];
          end if;
        end loop;

        exit when v_remaining_weight <= 0;

        v_any_capped := false;
        for i in 1..v_n loop
          if not v_capped[i] and v_raw_pct[i] * (v_remaining_budget / v_remaining_weight) > v_cap then
            v_capped[i] := true;
            v_share_pct[i] := v_cap;
            v_any_capped := true;
          end if;
        end loop;

        exit when not v_any_capped;
      end loop;

      -- Whoever's left uncapped splits whatever budget remains, in
      -- proportion to their own raw share.
      v_remaining_budget := 1.0;
      v_remaining_weight := 0;
      for i in 1..v_n loop
        if v_capped[i] then
          v_remaining_budget := v_remaining_budget - v_share_pct[i];
        else
          v_remaining_weight := v_remaining_weight + v_raw_pct[i];
        end if;
      end loop;
      if v_remaining_weight > 0 then
        for i in 1..v_n loop
          if not v_capped[i] then
            v_share_pct[i] := v_raw_pct[i] * (v_remaining_budget / v_remaining_weight);
          end if;
        end loop;
      end if;

      for i in 1..v_n loop
        -- Message still reports the REAL damage-dealt %, not the
        -- water-filled payout share — only the actual reward amount below
        -- is scaled up.
        v_message := 'You dealt ' || to_char(v_total_damage[i], 'FM999,999,999,999') || ' damage (' ||
          round(v_raw_pct[i] * 100) || '% of ' || v_boss_display_name || E'''s HP) in the fight!' || E'\n\n' || v_top5_text;

        -- Flat participation reward, unchanged: 1 Lottery Ticket for anyone
        -- who made at least one attempt, regardless of contribution size.
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_char_ids[i], 'lottery_ticket', 1, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);

        -- Water-filled share of each pool currency — still caps any single
        -- character's payout at 34% of the pool, but now redistributes
        -- whatever a timed-out boss's un-dealt HP would otherwise have
        -- voided among the real contributors instead of discarding it.
        for v_pool_row in select key as currency_type, value::int as pool_amount from jsonb_each_text(v_reward_pool) loop
          v_share := round(v_pool_row.pool_amount * v_share_pct[i]);
          if v_share > 0 then
            insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
            values (v_char_ids[i], v_pool_row.currency_type, v_share, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
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
  -- spawn.
  select boss_id, zone_top_level, defense_profile
  into v_boss_id, v_zone_top_level, v_defense_profile
  from public.zone_boss_catalog()
  where boss_id <> coalesce(v_last_boss_id, '')
  order by random()
  limit 1;

  v_max_hp := round(15000 * power(250000.0 / 15000.0, (v_zone_top_level - 25) / 104.0) / 5000.0)::bigint * 5000;
  v_base_defense := round(v_zone_top_level * 1.5)::integer;
  v_magic_base_defense := public.zone_boss_magic_defense_base(v_zone_top_level);
  if v_defense_profile = 'physical' then
    v_physical_defense := round(v_base_defense * 3.5)::integer;
    v_magic_defense := round(v_magic_base_defense * 1.3)::integer;
  else
    v_magic_defense := round(v_magic_base_defense * 3.5)::integer;
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
$function$;

revoke all on function public.ensure_world_boss_spawn() from public;
grant execute on function public.ensure_world_boss_spawn() to authenticated;
grant execute on function public.ensure_world_boss_spawn() to service_role;

commit;
