-- Composition point values switch to real Conquer-sourced numbers
-- (2026-08-11) — see CLAUDE.md's Gear system section. This exact sourced
-- table was reviewed once already (2026-08-07) and rejected in favor of the
-- old flat 10*3^(N-1)/20*3^max(L-1,0) formulas; re-confirmed with the user
-- this time, adopted as-is including its own odd discontinuity at +9->+10
-- rather than "fixed" to fit a clean curve, and composition now hard-caps at
-- +12 (there's no sourced data past it — previously uncapped).
--
-- Two shared helpers replace every inlined copy of the old formulas:
--   composition_point_value(tier): what a stone of that tier (or a fuel
--     item's own composition_level) is worth in points. Tier 1 = 10; tier
--     N >= 2 = 40 * 3^(N-2) (40/120/360/1080/3240/9720/29160 for tiers 2-8,
--     matching the sourced table exactly). Tiers 9-12 extrapolate the same
--     x3 step, since the source table only goes to tier 8 but items can
--     reach composition_level 12.
--   composition_points_required(level): points needed to advance level ->
--     level+1. A genuine lookup table (0..11), not a formula, because of the
--     +9->+10 discontinuity. Returns null at/above the new +12 cap.
begin;

create or replace function public.composition_point_value(p_tier integer)
returns integer
language sql
immutable
as $$
  select case
    when p_tier <= 0 then 0
    when p_tier = 1 then 10
    else (40 * (3::numeric ^ (p_tier - 2)))::integer
  end;
$$;

create or replace function public.composition_points_required(p_level integer)
returns integer
language sql
immutable
as $$
  select case p_level
    when 0 then 20
    when 1 then 20
    when 2 then 80
    when 3 then 240
    when 4 then 720
    when 5 then 2160
    when 6 then 6480
    when 7 then 19440
    when 8 then 58320
    when 9 then 2700
    when 10 then 5500
    when 11 then 9000
    else null
  end;
$$;

-- ============================================================================
-- composition_feed — same shape as before, now: (a) refuses the whole feed
-- upfront if the target item is already at the +12 cap (no partial waste,
-- same "no partial completion" pattern used elsewhere in this file), (b)
-- values stones/fuel via composition_point_value, (c) the tier-up loop uses
-- composition_points_required and stops at the cap.
-- ============================================================================
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

    select owner_id, composition_level into v_fuel_owner, v_fuel_level
    from public.item_instances
    where id = v_fuel_id;

    if not found or v_fuel_owner <> v_character_id then
      return jsonb_build_object('ok', false, 'error', 'fuel_not_owned', 'item_id', v_fuel_id);
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

  delete from public.item_instances where id = any(v_fuel_ids);

  v_composition_points := v_composition_points + v_total_points;

  loop
    v_required := public.composition_points_required(v_composition_level);
    exit when v_required is null;
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
    'points_required_for_next', coalesce(public.composition_points_required(v_composition_level), 0),
    'stones', v_new_stones
  );
end;
$$;

revoke all on function public.composition_feed(uuid, jsonb, uuid[]) from public;
grant execute on function public.composition_feed(uuid, jsonb, uuid[]) to authenticated;

-- ============================================================================
-- transfer_stone — same shape, point value now via composition_point_value.
-- ============================================================================
create or replace function public.transfer_stone(character_id uuid, tier integer, amount integer, direction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_stones jsonb;
  v_bank_points integer;
  v_tier_key text;
  v_owned integer;
  v_point_value integer;
  v_cost integer;
begin
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if tier < 1 or tier > 9 or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select account_id, composition_stones into v_account_id, v_stones
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select bank_points into v_bank_points from public.players where id = v_account_id for update;

  v_tier_key := tier::text;
  v_point_value := public.composition_point_value(tier);

  if direction = 'deposit' then
    v_owned := coalesce((v_stones ->> v_tier_key)::integer, 0);
    if v_owned < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_stones', 'owned', v_owned, 'requested', amount);
    end if;

    v_stones := jsonb_set(v_stones, array[v_tier_key], to_jsonb(v_owned - amount));
    v_bank_points := v_bank_points + v_point_value * amount;
  else
    v_cost := v_point_value * amount;
    if v_bank_points < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_points', 'have', v_bank_points, 'required', v_cost);
    end if;

    v_owned := coalesce((v_stones ->> v_tier_key)::integer, 0);
    v_stones := jsonb_set(v_stones, array[v_tier_key], to_jsonb(v_owned + amount));
    v_bank_points := v_bank_points - v_cost;
  end if;

  update public.characters set composition_stones = v_stones where id = character_id;
  update public.players set bank_points = v_bank_points where id = v_account_id;

  return jsonb_build_object('ok', true, 'stones', v_stones, 'bank_points', v_bank_points);
end;
$$;

revoke all on function public.transfer_stone(uuid, integer, integer, text) from public;
grant execute on function public.transfer_stone(uuid, integer, integer, text) to authenticated;

-- ============================================================================
-- deposit_item_as_composition — same shape, point value now via
-- composition_point_value (mirrors composition_feed's own fuel-item
-- valuation, same as before this migration, just via the shared helper now).
-- ============================================================================
create or replace function public.deposit_item_as_composition(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_composition_level integer;
  v_slot_type text;
  v_points_gained integer;
  v_points jsonb;
begin
  select owner_id, template_id, composition_level into v_character_id, v_template_id, v_composition_level
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, gear_composition_points into v_account_id, v_points
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type into v_slot_type from public.item_templates where id = v_template_id;

  if v_slot_type is null or v_slot_type not in ('weapon', 'ring', 'necklace', 'boots', 'hat', 'coat') then
    return jsonb_build_object('ok', false, 'error', 'unsupported_slot_type');
  end if;

  v_points_gained := public.composition_point_value(v_composition_level);

  if v_points_gained <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_points_contributed');
  end if;

  v_points := jsonb_set(v_points, array[v_slot_type], to_jsonb(coalesce((v_points ->> v_slot_type)::integer, 0) + v_points_gained));

  update public.characters set gear_composition_points = v_points where id = v_character_id;

  delete from public.item_instances where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'slot_type', v_slot_type,
    'points_gained', v_points_gained,
    'gear_composition_points', v_points
  );
end;
$$;

revoke all on function public.deposit_item_as_composition(uuid) from public;
grant execute on function public.deposit_item_as_composition(uuid) to authenticated;

-- ============================================================================
-- withdraw_gear_composition — same shape, point value now via
-- composition_point_value, and composition_level is now bounded at the same
-- +12 cap composition_feed enforces (previously unbounded above).
-- ============================================================================
create or replace function public.withdraw_gear_composition(character_id uuid, template_id uuid, composition_level integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_points jsonb;
  v_slot_type text;
  v_owned integer;
  v_cost integer;
  v_new_item public.item_instances;
begin
  if composition_level < 0 or composition_level > 12 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select account_id, gear_composition_points into v_account_id, v_points
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type into v_slot_type from public.item_templates where id = template_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;

  if v_slot_type is null or v_slot_type not in ('weapon', 'ring', 'necklace', 'boots', 'hat', 'coat') then
    return jsonb_build_object('ok', false, 'error', 'unsupported_slot_type');
  end if;

  v_owned := coalesce((v_points ->> v_slot_type)::integer, 0);
  v_cost := public.composition_point_value(composition_level);

  if v_owned < v_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_points', 'required', v_cost, 'owned', v_owned);
  end if;

  v_points := jsonb_set(v_points, array[v_slot_type], to_jsonb(v_owned - v_cost));

  update public.characters set gear_composition_points = v_points where id = character_id;

  insert into public.item_instances (owner_id, template_id, composition_level)
  values (character_id, template_id, composition_level)
  returning * into v_new_item;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_new_item),
    'slot_type', v_slot_type,
    'gear_composition_points', v_points
  );
end;
$$;

revoke all on function public.withdraw_gear_composition(uuid, uuid, integer) from public;
grant execute on function public.withdraw_gear_composition(uuid, uuid, integer) to authenticated;

commit;
