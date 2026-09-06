-- Fixes a real balance bug found while investigating a user question about
-- Skytalon feeling too tough for a Wuxia (magic attacker): the "weak" side
-- of a Zone Boss's defense could end up NUMERICALLY HIGHER than its "strong"
-- side. physical_defense is derived from base_physical = level * 1.5, but
-- magic_defense's own base (zone_boss_magic_defense_base, added in
-- 20261214020000_zone_boss_magic_defense_baseline_fix.sql to stop magic
-- bosses being trivial for a real magic attacker) grows far faster than that
-- -- roughly 3.5x-7x bigger at every level. The old formula multiplied
-- whichever side was "weak" by only 1.3x its OWN curve's base, which is fine
-- when the weak side is physical (small curve, stays small) but breaks
-- completely when the weak side is magic on a 'physical'-profile boss: 1.3x
-- of the big magic curve still comfortably exceeds 3.5x of the small
-- physical curve. Confirmed for all 4 'physical'-profile bosses:
--   Emberroot (45): old physical=238 (strong) vs magic=303 (supposed weak)
--   Karthos   (85): old physical=448 (strong) vs magic=582 (supposed weak)
--   Skytalon  (100): old physical=525 (strong) vs magic=698 (supposed weak)
--   Twistpath Warden (120): old physical=630 (strong) vs magic=820 (weak)
-- Every 'magical'-profile boss (Mourncrow/Thundermane/Nyxharrow/Glacius) was
-- already correctly ordered (strong > weak) purely because their own strong
-- side already uses the big magic curve, so this bug never showed up there.
--
-- Fix: for a 'physical'-profile boss, magic_defense (weak) is now derived
-- directly from that boss's own physical_defense (strong) using the same
-- 1.3/3.5 ratio (13/35) the design always intended, instead of from the
-- mismatched magic curve -- structurally impossible to invert again
-- regardless of how either base curve is retuned in the future.
-- 'magical'-profile bosses are untouched (their physical_defense derivation
-- was never broken; deriving it the same way from magic_defense would
-- roughly triple it -- e.g. Thundermane 127 -> 433 -- an unrequested
-- difficulty spike on bosses nobody reported an issue with).
--
-- ensure_world_boss_spawn's full body is otherwise unchanged from the live
-- version (last touched by 20261212000000_zone_boss_reward_pool_restore_
-- and_retune.sql / 20261214020000's own redefine).
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

  if v_status = 'active' and now() < v_window_ends_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

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
        v_pct := case when v_max_hp > 0 then v_participant.total_damage::numeric / v_max_hp else 0 end;
        v_message := 'You dealt ' || to_char(v_participant.total_damage, 'FM999,999,999,999') || ' damage (' ||
          round(v_pct * 100) || '% of ' || v_boss_display_name || E'''s HP) in the fight!' || E'\n\n' || v_top5_text;

        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_participant.character_id, 'lottery_ticket', 1, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);

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

  if v_next_spawn_at is null or now() < v_next_spawn_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

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
    -- Bug fix (2026-09-06): derived from this boss's own strong side (same
    -- 1.3/3.5 ratio as always intended) instead of round(v_magic_base_defense
    -- * 1.3), which used the much-steeper magic curve directly and could
    -- end up bigger than the "strong" physical_defense above -- see this
    -- migration's header for the full explanation and confirmed numbers.
    v_magic_defense := round(v_physical_defense * 13.0 / 35.0)::integer;
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
$$;

-- Retroactively correct the currently-active spawn if it's on the broken
-- side of this bug (a 'physical'-profile boss whose magic_defense was rolled
-- under the old formula) -- otherwise players fighting it right now would
-- have to wait out the rest of this spawn's multi-hour window before the
-- fix actually applies to them.
update public.world_boss_spawns ws
set magic_defense = round(ws.physical_defense * 13.0 / 35.0)
from public.world_boss_state s, public.zone_boss_catalog() cat
where ws.id = s.current_spawn_id
  and ws.status = 'active'
  and cat.boss_id = ws.boss_id
  and cat.defense_profile = 'physical';

commit;
