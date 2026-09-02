-- Zone Boss HP was too low at the bottom of the curve: the old formula
-- anchored 2,000 HP at level 1 (a level no boss actually has — the lowest,
-- Mourncrow, is level 25) up to ~50,000 HP at level 129, so Mourncrow only
-- rolled ~3,640 max_hp in practice — a 2-hit kill for players well past
-- Windhollow. Re-anchored to the bosses' real level range (25-129) with a
-- much higher floor/ceiling: 15,000 HP at level 25 up to 250,000 HP at
-- level 129, then snapped to the nearest 5,000 for a round display number
-- (Mourncrow 15,000 / Emberroot 25,000 / Thundermane 45,000 / Karthos
-- 75,000 / Skytalon 115,000 / Nyxharrow & Twistpath Warden 195,000 /
-- Glacius 250,000). Same exponential-curve shape, only the anchor points
-- and the final rounding changed.
-- Full function body copied from 20261116000000 (latest prior version) with
-- only the v_max_hp line changed.
begin;

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
        -- Share of the BOSS's max_hp, not share of total damage dealt by
        -- attendees — see 20261116000000's header for why this distinction
        -- is the whole fix.
        v_pct := case when v_max_hp > 0 then v_participant.total_damage::numeric / v_max_hp else 0 end;
        v_message := 'You dealt ' || to_char(v_participant.total_damage, 'FM999,999,999,999') || ' damage (' ||
          round(v_pct * 100) || '% of ' || v_boss_display_name || E'''s HP) in the fight!' || E'\n\n' || v_top5_text;

        -- Flat participation reward, unchanged: 1 Lottery Ticket for anyone
        -- who made at least one attempt, regardless of contribution size.
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_participant.character_id, 'lottery_ticket', 1, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);

        -- Proportional share of each pool currency — any share of the pool
        -- corresponding to HP nobody actually damaged (a boss that timed
        -- out un-killed) is simply never paid to anyone.
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
  -- spawn.
  select boss_id, zone_top_level, defense_profile
  into v_boss_id, v_zone_top_level, v_defense_profile
  from public.zone_boss_catalog()
  where boss_id <> coalesce(v_last_boss_id, '')
  order by random()
  limit 1;

  -- Re-anchored to the bosses' real level range: 15,000 HP at level 25
  -- (Mourncrow, the lowest) up to 250,000 HP at level 129 (Glacius, the
  -- highest), then snapped to the nearest 5,000 for a round display number.
  -- Was `2000 * power(50000/2000, (L-1)/129)`, anchored at level 1 (no boss
  -- is level 1), which put Mourncrow at only ~3,640 HP.
  v_max_hp := round(15000 * power(250000.0 / 15000.0, (v_zone_top_level - 25) / 104.0) / 5000.0)::bigint * 5000;
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

commit;
