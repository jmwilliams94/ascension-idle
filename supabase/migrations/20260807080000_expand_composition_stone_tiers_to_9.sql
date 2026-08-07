-- Composition Stones expand from 4 tiers to 9 (real art now exists for
-- tiers 1-5, 6-9 still pending — see CLAUDE.md's Gear system > Composition).
-- The point-value/points-required formulas already generalize to any tier
-- (10 * 3^(N-1) per stone, 20 * 3^max(L-1,0) per composition_level) so no
-- formula changes are needed here, just the hard-coded "> 4" bounds checks
-- in the three RPCs that gate which tiers are accepted.
begin;

alter table public.characters
  alter column composition_stones set default
    '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0}'::jsonb;

alter table public.players
  alter column composition_stones_banked set default
    '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0}'::jsonb;

-- Backfill existing rows so newly-added tier keys read as 0 rather than
-- missing (functions already coalesce missing keys to 0, this is just for
-- clients that read the jsonb object's own keys directly, e.g. Object.keys).
update public.characters
set composition_stones = composition_stones || '{"5":0,"6":0,"7":0,"8":0,"9":0}'::jsonb
where not (composition_stones ? '9');

update public.players
set composition_stones_banked = composition_stones_banked || '{"5":0,"6":0,"7":0,"8":0,"9":0}'::jsonb
where not (composition_stones_banked ? '9');

-- ============================================================================
-- composition_feed: tier bound 4 -> 9 (see 20260728000000_add_composition.sql)
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

    if v_fuel_level > 0 then
      v_total_points := v_total_points + (10 * (3::numeric ^ (v_fuel_level - 1)))::integer;
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

-- ============================================================================
-- transfer_stone: tier bound 4 -> 9 (see 20260803100000_rename_warehouse_points_to_bank_points.sql)
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
  v_point_value := (10 * (3::numeric ^ (tier - 1)))::integer;

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
-- bank_stone_item: tier bound (1,2,3,4) -> (1..9) (see 20260803080000_bank_account_wide.sql)
-- ============================================================================
create or replace function public.bank_stone_item(
  character_id uuid,
  tier integer,
  direction text,
  amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_stones jsonb;
  v_banked jsonb;
  v_count integer;
  v_bank_count integer;
  v_key text;
begin
  if tier not in (1, 2, 3, 4, 5, 6, 7, 8, 9) then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;
  if amount is null or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_key := tier::text;

  select account_id, composition_stones into v_account_id, v_stones
  from public.characters where id = character_id for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select composition_stones_banked into v_banked from public.players where id = v_account_id for update;

  v_count := coalesce((v_stones ->> v_key)::integer, 0);
  v_bank_count := coalesce((v_banked ->> v_key)::integer, 0);

  if direction = 'deposit' then
    if v_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_stones');
    end if;
    v_count := v_count - amount;
    v_bank_count := v_bank_count + amount;
  else
    if v_bank_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_stones');
    end if;
    v_bank_count := v_bank_count - amount;
    v_count := v_count + amount;
  end if;

  v_stones := jsonb_set(v_stones, array[v_key], to_jsonb(v_count));
  v_banked := jsonb_set(v_banked, array[v_key], to_jsonb(v_bank_count));

  update public.characters set composition_stones = v_stones where id = character_id;
  update public.players set composition_stones_banked = v_banked where id = v_account_id;

  return jsonb_build_object('ok', true, 'stones', v_stones, 'stones_banked', v_banked);
end;
$$;

revoke all on function public.bank_stone_item(uuid, integer, text, integer) from public;
grant execute on function public.bank_stone_item(uuid, integer, text, integer) to authenticated;

commit;
