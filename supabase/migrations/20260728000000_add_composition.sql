-- Composition: the third Forge upgrade path (see CLAUDE.md's Gear system section),
-- a points accumulator with guaranteed progress and no RNG, distinct from Quality
-- Upgrade and Level Upgrade. composition_level already exists on item_instances
-- (0 = Normal, 1 = "+1", etc.) — this adds the points counter and the stackable
-- stone currency, plus the one function that mutates either.

alter table public.item_instances add column if not exists composition_points integer not null default 0;
alter table public.item_instances add constraint item_instances_composition_points_check check (composition_points >= 0);

-- Per-character stone stacks, keyed by tier ("1".."4") as text since jsonb object
-- keys are always strings. No CHECK constraint enforcing non-negative values here —
-- unlike a plain integer column, a jsonb CHECK would need a set-returning function
-- (jsonb_each_text), which Postgres does not allow inside a CHECK expression.
-- composition_feed (below) is the only intended mutator and validates before
-- deducting; characters.composition_stones follows the same trust model as
-- meteors/dragonballs (see CLAUDE.md's Persistence section) — never written by the
-- generic character autosave, only ever read on load and refreshed from this
-- function's response.
alter table public.characters
  add column if not exists composition_stones jsonb not null default '{"1": 0, "2": 0, "3": 0, "4": 0}'::jsonb;

create or replace function public.composition_feed(item_id uuid, stone_amounts jsonb, fuel_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_composition_level integer;
  v_composition_points integer;
  v_stones jsonb;
  v_new_stones jsonb;
  v_tier_key text;
  v_tier_amount integer;
  v_tier_num integer;
  v_owned integer;
  v_total_points integer := 0;
  v_fuel_ids uuid[];
  v_fuel_id uuid;
  v_fuel_owner uuid;
  v_fuel_level integer;
  v_required integer;
begin
  select owner_id, composition_level, composition_points into v_character_id, v_composition_level, v_composition_points
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, composition_stones into v_account_id, v_stones
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  -- Dedupe fuel ids up front — without this, the same real item id repeated twice
  -- in the array would count its point value twice while only actually being
  -- deleted once (a delete-by-id is naturally idempotent), inflating the feed.
  v_fuel_ids := array(select distinct unnest(coalesce(fuel_item_ids, array[]::uuid[])));

  -- Validate everything (requested stones affordable, fuel owned) before mutating
  -- anything, so a bad request fails clean with no partial effect.
  for v_tier_key, v_tier_amount in select key, value::integer from jsonb_each_text(coalesce(stone_amounts, '{}'::jsonb))
  loop
    if v_tier_amount = 0 then
      continue;
    end if;

    v_tier_num := v_tier_key::integer;
    if v_tier_amount < 0 or v_tier_num < 1 or v_tier_num > 4 then
      return jsonb_build_object('ok', false, 'error', 'invalid_stone_tier', 'tier', v_tier_key);
    end if;

    v_owned := coalesce((v_stones ->> v_tier_key)::integer, 0);
    if v_owned < v_tier_amount then
      return jsonb_build_object(
        'ok', false,
        'error', 'not_enough_stones',
        'tier', v_tier_key,
        'owned', v_owned,
        'requested', v_tier_amount
      );
    end if;

    -- Stone tier N is worth 10 * 3^(N-1) points (see forgeCosts.ts's
    -- compositionPointValue — keep in sync).
    v_total_points := v_total_points + v_tier_amount * (10 * (3::numeric ^ (v_tier_num - 1)))::integer;
  end loop;

  foreach v_fuel_id in array v_fuel_ids
  loop
    if v_fuel_id = item_id then
      return jsonb_build_object('ok', false, 'error', 'fuel_is_target_item', 'item_id', v_fuel_id);
    end if;

    select owner_id, composition_level into v_fuel_owner, v_fuel_level
    from public.item_instances
    where id = v_fuel_id;

    if not found or v_fuel_owner <> v_character_id then
      return jsonb_build_object('ok', false, 'error', 'fuel_not_owned', 'item_id', v_fuel_id);
    end if;

    -- A fuel item's own composition_level values the same as a stone of that tier
    -- would — 0 (Normal, uncomposed) contributes nothing.
    if v_fuel_level > 0 then
      v_total_points := v_total_points + (10 * (3::numeric ^ (v_fuel_level - 1)))::integer;
    end if;
  end loop;

  if v_total_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_points_contributed');
  end if;

  -- Validated — now actually deduct stones, destroy fuel, and apply points.
  v_new_stones := v_stones;
  for v_tier_key, v_tier_amount in select key, value::integer from jsonb_each_text(coalesce(stone_amounts, '{}'::jsonb))
  loop
    if v_tier_amount > 0 then
      v_new_stones := jsonb_set(
        v_new_stones,
        array[v_tier_key],
        to_jsonb(coalesce((v_new_stones ->> v_tier_key)::integer, 0) - v_tier_amount)
      );
    end if;
  end loop;

  update public.characters set composition_stones = v_new_stones where id = v_character_id;

  -- Fuel items are destroyed outright — only their composition_level/points
  -- counted, every other stat/quality/socket on them is discarded.
  delete from public.item_instances where id = any(v_fuel_ids);

  v_composition_points := v_composition_points + v_total_points;

  -- Resolve tier-ups in a loop so a single large feed can cross multiple tiers at
  -- once, carrying leftover points forward correctly each time.
  loop
    v_required := (20 * (3::numeric ^ greatest(v_composition_level - 1, 0)))::integer;
    exit when v_composition_points < v_required;
    v_composition_points := v_composition_points - v_required;
    v_composition_level := v_composition_level + 1;
  end loop;

  update public.item_instances
  set composition_level = v_composition_level, composition_points = v_composition_points
  where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'composition_level', v_composition_level,
    'composition_points', v_composition_points,
    'points_required_for_next', (20 * (3::numeric ^ greatest(v_composition_level - 1, 0)))::integer,
    'stones', v_new_stones
  );
end;
$$;

revoke all on function public.composition_feed(uuid, jsonb, uuid[]) from public;
grant execute on function public.composition_feed(uuid, jsonb, uuid[]) to authenticated;
