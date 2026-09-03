-- Zone Boss magic_defense baseline fix (v1.130.0).
--
-- Root cause found while investigating "a Wuxia still out-damages a Hunter
-- against a magic-specialty boss even with the 50% specialty penalty
-- (20261214000000-adjacent Edge Function change) applied": ensure_world_boss_spawn
-- derives BOTH physical_defense and magic_defense from the same
-- `base_defense = round(zone_top_level * 1.5)` number — that's
-- monsterDefense's own formula (src/game/combat/combatResolver.ts), built
-- and tuned for PHYSICAL attacks only. Live Hunting has a separate,
-- dedicated MONSTER_MAGIC_DEFENSE_ANCHORS table specifically because a
-- Wuxia's raw magicAttack (Spirit-driven + Backsword/Bracelet) vastly
-- outscales a same-tier Hunter's physicalAttack — reusing the physical
-- formula for Zone Boss's magic side means the boss's magic defense has
-- always been sized for a physical attacker, never for a real magic one,
-- explaining why even a large specialty multiplier (3.5x) couldn't keep up.
--
-- Fix: zone_boss_magic_defense_base(level) below mirrors combatResolver.ts's
-- monsterMagicDefenseBase/MONSTER_MAGIC_DEFENSE_ANCHORS exactly (same 27
-- anchors, same linear interpolation) and is now what magic_defense's
-- specialty/weak split multiplies, instead of the physical base_defense.
-- physical_defense is untouched (its baseline was already correct).
-- Recompute this table (see combatResolver.ts's own header comment) if
-- MONSTER_MAGIC_DEFENSE_ANCHORS is ever recomputed there.
--
-- Modeled against Nyxharrow (zone_top_level 120, magical specialty):
-- magic_defense goes from round(180*3.5)=630 to round(1584*3.5)=5,544. A
-- maxed Wuxia (Astral Backsword, comp 7, 140% Ember) drops from ~2,026-2,546
-- dmg/hit (post the now-redundant 50% specialty penalty, see the companion
-- Edge Function revert below) to ~468-572 dmg/hit — floors out almost every
-- hit, correctly weak against a magic-defense boss. A same-tier Hunter is
-- unaffected (~1,467-1,845 dmg/hit, physical_defense's baseline didn't
-- change). On a physical-specialty boss the same Wuxia's magic_defense
-- baseline becomes the WEAK side (round(1584*1.3)=2,059), swinging the
-- matchup the other way — real rock-paper-scissors, confirmed with the
-- user to be an acceptable outcome even where the favorable matchup can
-- exceed the 34% damage cap on best-case rolls (takes the full 20
-- attempts either way, and rewards bringing the right class).
--
-- The Edge Function's separate flat 50% specialty-side damage penalty
-- (world-boss-attack/index.ts, added the same session) is removed in this
-- deploy — it's now redundant for a maxed attacker (the corrected baseline
-- alone already floors them) and would otherwise double-suppress a
-- moderately-geared character's off-type damage with no real benefit.

begin;

create or replace function public.zone_boss_magic_defense_base(p_level integer)
returns integer
language plpgsql
immutable
as $$
declare
  anchors integer[][] := array[
    array[1,7], array[5,25], array[10,30], array[15,68], array[20,103],
    array[25,143], array[30,172], array[35,213], array[40,257], array[45,312],
    array[50,350], array[55,406], array[60,439], array[65,502], array[70,540],
    array[75,634], array[80,675], array[85,773], array[90,822], array[95,943],
    array[100,993], array[105,1135], array[110,1188], array[115,1437],
    array[120,1584], array[125,2249], array[130,2987]
  ];
  v_level integer := least(greatest(p_level, anchors[1][1]), anchors[array_length(anchors,1)][1]);
  v_prev_level integer;
  v_prev_value integer;
  v_anchor_level integer;
  v_anchor_value integer;
  v_t numeric;
begin
  for i in 1..array_length(anchors,1) loop
    v_anchor_level := anchors[i][1];
    v_anchor_value := anchors[i][2];

    if v_level = v_anchor_level then
      return v_anchor_value;
    end if;

    if v_level < v_anchor_level then
      v_prev_level := anchors[i-1][1];
      v_prev_value := anchors[i-1][2];
      v_t := (v_level - v_prev_level)::numeric / (v_anchor_level - v_prev_level);
      return round(v_prev_value + (v_anchor_value - v_prev_value) * v_t);
    end if;
  end loop;

  return anchors[array_length(anchors,1)][2];
end;
$$;

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
  v_magic_base_defense integer;
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
        select row_number() over (order by wbp.total_damage desc, wbp.last_attempt_at asc) as rn, c.name as character_name, wbp.total_damage
        from public.world_boss_participants wbp
        join public.characters c on c.id = wbp.character_id
        where wbp.spawn_id = v_current_spawn_id and (wbp.free_attempts_used + wbp.paid_attempts_used) > 0
        order by wbp.total_damage desc, wbp.last_attempt_at asc
        limit 5
      ) ranked;

      for v_participant in
        select character_id, total_damage, row_number() over (order by total_damage desc, last_attempt_at asc) as rn
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

-- One-time correction so the currently-active spawn picks up the new
-- baseline immediately, instead of only future rolls (a spawn's window can
-- run up to 8h, plus a 1-6h gap before the next roll — too long to leave
-- live with the old, undersized magic_defense).
update public.world_boss_spawns s
set
  physical_defense = case when cat.defense_profile = 'physical'
    then round(round(cat.zone_top_level * 1.5) * 3.5)::integer
    else round(round(cat.zone_top_level * 1.5) * 1.3)::integer
  end,
  magic_defense = case when cat.defense_profile = 'physical'
    then round(public.zone_boss_magic_defense_base(cat.zone_top_level) * 1.3)::integer
    else round(public.zone_boss_magic_defense_base(cat.zone_top_level) * 3.5)::integer
  end
from public.zone_boss_catalog() cat
where cat.boss_id = s.boss_id and s.status = 'active';

commit;
