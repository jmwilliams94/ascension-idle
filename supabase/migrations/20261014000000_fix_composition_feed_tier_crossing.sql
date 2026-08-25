-- Fix composition_feed: crossing a composition tier lost the item's existing
-- composition_points instead of carrying them into the tier-up loop.
--
-- Regression introduced in 20260930010000_gear_lock_and_gear_score.sql, whose
-- own comment claimed the body was "an unchanged copy" of 20260811040000 --
-- it wasn't. That version dropped the pre-loop
-- `v_composition_points := v_composition_points + v_total_points;` merge and
-- instead zeroed v_composition_points inside the loop while only subtracting
-- v_required from v_total_points, so any feed that actually crossed a tier
-- (composition_points + newly-added points >= required) discarded the
-- pre-existing points and could go negative -- violating
-- item_instances_composition_points_check (composition_points >= 0) and
-- raising an uncaught exception. The transaction rolled back (no stones/fuel
-- were lost), but the client's compositionFeed() swallows a raw RPC-level
-- error to `{ ok: false }` with no error code, which the UI renders as an
-- opaque "Something went wrong." -- a feed that stayed within the current
-- tier never hit the buggy branch, so only tier-crossing feeds failed.
--
-- Fix: restore the original correct pattern (merge before the loop, run the
-- loop on v_composition_points alone) and drop the pointless nested
-- declare/begin/end block that had crept in around it.
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
  v_fuel_locked boolean;
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

  if public.composition_points_required(v_composition_level) is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_composition', 'composition_level', v_composition_level);
  end if;

  v_fuel_ids := array(select distinct unnest(coalesce(fuel_item_ids, array[]::uuid[])));

  for v_tier_key, v_tier_amount in select key, value::integer from jsonb_each_text(coalesce(stone_amounts, '{}'::jsonb))
  loop
    if v_tier_amount = 0 then
      continue;
    end if;

    v_tier_num := v_tier_key::integer;
    if v_tier_amount < 0 or v_tier_num < 1 or v_tier_num > 9 then
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

    v_total_points := v_total_points + v_tier_amount * public.composition_point_value(v_tier_num);
  end loop;

  foreach v_fuel_id in array v_fuel_ids
  loop
    if v_fuel_id = item_id then
      return jsonb_build_object('ok', false, 'error', 'fuel_is_target_item', 'item_id', v_fuel_id);
    end if;

    select owner_id, composition_level, locked into v_fuel_owner, v_fuel_level, v_fuel_locked
    from public.item_instances
    where id = v_fuel_id;

    if not found or v_fuel_owner <> v_character_id then
      return jsonb_build_object('ok', false, 'error', 'fuel_not_owned', 'item_id', v_fuel_id);
    end if;

    if v_fuel_locked then
      return jsonb_build_object('ok', false, 'error', 'fuel_locked', 'item_id', v_fuel_id);
    end if;

    if v_fuel_level > 0 then
      v_total_points := v_total_points + public.composition_point_value(v_fuel_level);
    end if;
  end loop;

  if v_total_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_points_contributed');
  end if;

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

  if array_length(v_fuel_ids, 1) > 0 then
    delete from public.item_instances where id = any(v_fuel_ids);
  end if;

  v_composition_points := v_composition_points + v_total_points;

  loop
    v_required := public.composition_points_required(v_composition_level);
    exit when v_required is null or v_composition_points < v_required;
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
    'points_required_for_next', public.composition_points_required(v_composition_level),
    'stones', v_new_stones
  );
end;
$$;
