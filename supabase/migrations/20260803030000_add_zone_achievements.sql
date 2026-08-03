-- Zone-level Achievements layer (confirmed with the user, 2026-08-03, see
-- CLAUDE.md's Achievements & Pets section) -- ADDITIVE to the existing
-- per-monster Kill Count/Prestige system, not a replacement (confirmed
-- explicitly after an earlier draft of this feature wrongly assumed
-- replacement). Per-monster Kill Count keeps its exact existing shape (6
-- tiers, highest-tier-reached wins, automatic) -- only its reward category
-- changes, from the old shared gold multiplier to its own bonus-currency-
-- drop-chance multiplier, since "Unlocks" (renamed Prestige below) now
-- solely owns the gold/yield multiplier.
--
-- New, additive concept: each zone (always exactly 5 monsters, confirmed by
-- CLAUDE.md's Zones section) tracks how many of its 5 monsters' x 6 tiers =
-- 30 possible tier-milestones have been reached in total, across that
-- character's own per-monster kill counts -- e.g. "3/30 tiers completed."
-- Crossing a zone-level milestone (5/10/15/20/25/30, an even 6-step ladder
-- matching every other tier system in this game) grants a one-time zone
-- reward (DragonBalls, escalating per zone tier -- placeholder amounts,
-- unresolved per CLAUDE.md like the rest of this game's economy numbers).
-- The zone total is display-computed live, client-side, from the same
-- per-monster kill counts already loaded (useAchievementsStore's
-- characterKills) -- character_zone_progress below exists purely so
-- resolve-combat can tell "have I already granted this zone tier's reward"
-- without re-granting it every subsequent kill; the client never reads it.
begin;

-- ============================================================================
-- enemy_types.zone_id -- server-side mirror of zoneData.ts's ZONES[...].
-- monsterOrder, inverted (monster -> zone). Needed so resolve-combat (which
-- only ever knows about the ONE monster just fought) can find the other 4
-- monsters in the same zone to compute the zone's aggregate.
-- ============================================================================
alter table public.enemy_types add column if not exists zone_id text;

update public.enemy_types set zone_id = 'windhollow' where id in ('quailwing', 'mourning-dove', 'redbreast', 'warshade', 'grim-specter');
update public.enemy_types set zone_id = 'cinderleaf' where id in ('wingfang-serpent', 'brushrunner', 'thornreaver', 'woodkin', 'woodkin-sovereign');
update public.enemy_types set zone_id = 'stormvale' where id in ('ridgeback-simian', 'boulder-ape', 'bellowing-brute', 'frostpelt', 'venomkin');
update public.enemy_types set zone_id = 'sunscar-wastes' where id in ('dunecrawler', 'cragbeast', 'boulderback-golem', 'stonewarden', 'edgeborn');
update public.enemy_types set zone_id = 'talon-isle' where id in ('wingkin', 'wingkin-sovereign', 'hawklord', 'silverwing', 'footpad');
update public.enemy_types set zone_id = 'duskspire-keep' where id in ('cryptwing', 'crimson-wing', 'crimson-sovereign', 'ironhorn-fiend', 'verdant-fiend');
update public.enemy_types set zone_id = 'twistpath-ruins' where id in ('ratling-flinger', 'gilded-wraith', 'swiftgnaw', 'nightfiend', 'bullhorn-warden');
update public.enemy_types set zone_id = 'rimehollow' where id in ('rime-serpent', 'serpent-herald', 'serpent-warden', 'fiend-sovereign', 'frostblade-fiend');

-- ============================================================================
-- character_zone_progress: server-only bookkeeping (see header) -- one row
-- per (character, zone) once any reward has been granted, tracking the
-- highest zone tier (0-6) already paid out, so a later kill in that zone
-- doesn't re-grant an already-earned tier's reward.
-- ============================================================================
create table if not exists public.character_zone_progress (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  zone_id text not null,
  highest_zone_tier_granted integer not null default 0,
  constraint character_zone_progress_tier_check check (highest_zone_tier_granted between 0 and 6),
  constraint character_zone_progress_unique unique (character_id, zone_id)
);

alter table public.character_zone_progress enable row level security;

do $$ begin
  create policy "Characters can view their own zone progress"
    on public.character_zone_progress for select
    using (exists (select 1 from public.characters c where c.id = character_zone_progress.character_id and c.account_id = auth.uid()));
exception when duplicate_object then null;
end $$;

-- No insert/update/delete grant -- resolve-combat (service-role) is the only writer.
grant select on public.character_zone_progress to authenticated;

-- ============================================================================
-- unlock_next_achievement_tier: gains the Kill Count Tier 1 prerequisite
-- (confirmed with the user) -- "to proceed to the next Prestige you need to
-- complete the 1st round of Kill Count." A one-time gate, not a per-tier
-- parallel requirement: kills only ever go up, so once true it stays true
-- for every future call regardless of which Prestige tier is being bought.
-- ============================================================================
create or replace function public.unlock_next_achievement_tier(p_character_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_meteors integer;
  v_dragonballs integer;
  v_current_index integer;
  v_kills integer;
  v_next_index integer;
  v_currency text;
  v_cost integer;
  v_new_meteors integer;
  v_new_dragonballs integer;
begin
  select account_id, meteor_count, dragonball_count into v_account_id, v_meteors, v_dragonballs
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select unlocked_tier_index, kills into v_current_index, v_kills
  from public.character_monster_kills
  where character_id = p_character_id
    and monster_id = p_monster_id;

  v_current_index := coalesce(v_current_index, 0);
  v_kills := coalesce(v_kills, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  if v_kills < 100 then
    return jsonb_build_object('ok', false, 'error', 'kill_count_tier_required', 'kills', v_kills, 'kills_required', 100);
  end if;

  case v_next_index
    when 1 then v_currency := 'meteor'; v_cost := 1;
    when 2 then v_currency := 'meteor'; v_cost := 3;
    when 3 then v_currency := 'meteor'; v_cost := 5;
    when 4 then v_currency := 'meteor'; v_cost := 10;
    when 5 then v_currency := 'meteor'; v_cost := 20;
    when 6 then v_currency := 'dragonball'; v_cost := 1;
  end case;

  if v_currency = 'meteor' then
    if v_meteors < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_meteors', 'cost', v_cost, 'currency', v_currency, 'meteors', v_meteors);
    end if;
    update public.characters set meteor_count = meteor_count - v_cost where id = p_character_id
    returning meteor_count into v_new_meteors;
    v_new_dragonballs := v_dragonballs;
  else
    if v_dragonballs < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_dragonballs', 'cost', v_cost, 'currency', v_currency, 'dragonballs', v_dragonballs);
    end if;
    update public.characters set dragonball_count = dragonball_count - v_cost where id = p_character_id
    returning dragonball_count into v_new_dragonballs;
    v_new_meteors := v_meteors;
  end if;

  insert into public.character_monster_kills (character_id, monster_id, kills, unlocked_tier_index)
  values (p_character_id, p_monster_id, 0, v_next_index)
  on conflict (character_id, monster_id)
  do update set unlocked_tier_index = v_next_index;

  return jsonb_build_object(
    'ok', true,
    'unlocked_tier_index', v_next_index,
    'currency', v_currency,
    'cost', v_cost,
    'meteors_remaining', v_new_meteors,
    'dragonballs_remaining', v_new_dragonballs
  );
end;
$$;

revoke all on function public.unlock_next_achievement_tier(uuid, text) from public;
grant execute on function public.unlock_next_achievement_tier(uuid, text) to authenticated;

commit;
