-- Global announcement when a composition feed pushes an item's composition_level
-- from below +8 up to +8 or higher (a feed can cross multiple tiers in one
-- call, e.g. +6 -> +9, so this checks the level actually reached, not a
-- fixed +8 write) -- composition_feed is the only path that reaches +8+
-- today (composition_plus_one_drops.sql's RNG drop roll only ever lands +1).
-- Mirrors the armor_socket/level_130 pattern in global_announcements: new
-- 'composition_plus_8' kind, no CHECK constraint on global_announcements.kind
-- to widen, insert only (composition_feed is already security definer so no
-- new grant is needed).
create or replace function public.composition_feed(item_id uuid, stone_amounts jsonb, fuel_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_name text;
  v_composition_level integer;
  v_composition_level_before integer;
  v_composition_points integer;
  v_item_name text;
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

  select account_id, composition_stones, name into v_account_id, v_stones, v_character_name
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
  v_composition_level_before := v_composition_level;

  loop
    v_required := public.composition_points_required(v_composition_level);
    exit when v_required is null or v_composition_points < v_required;
    v_composition_points := v_composition_points - v_required;
    v_composition_level := v_composition_level + 1;
  end loop;

  update public.item_instances
  set composition_level = v_composition_level, composition_points = v_composition_points
  where id = item_id;

  if v_composition_level_before < 8 and v_composition_level >= 8 then
    select name into v_item_name from public.item_templates
    where id = (select template_id from public.item_instances where id = item_id);

    insert into public.global_announcements (kind, character_name, message)
    values (
      'composition_plus_8',
      v_character_name,
      v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' reached +' || v_composition_level || '!'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'composition_level', v_composition_level,
    'composition_points', v_composition_points,
    'points_required_for_next', public.composition_points_required(v_composition_level),
    'stones', v_new_stones
  );
end;
$$;
