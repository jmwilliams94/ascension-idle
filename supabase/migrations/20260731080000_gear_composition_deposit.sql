-- Stage 4 of the Bank/Warehouse economy redesign (see CLAUDE.md's Accounts &
-- Characters -> Warehouse note, and stages 1-3's migrations). Gear gains a
-- second, independent Warehouse deposit path alongside the existing
-- deposit_item/warehouse_items mechanic (unchanged, still preserves the exact
-- template as a fungible token):
--
-- "Deposit as Composition" destroys the item outright (identity, rolled
-- stats, quality, level -- all discarded, same as feeding it as Composition
-- fuel already does) and adds its composition_level's point value into a
-- pool scoped to that gear's own slot_type -- six separate, NON-fungible
-- pools (weapon/ring/necklace/boots/hat/coat), unlike the existing shared
-- warehouse_points balance stones/item-deposits liquidate into. A Ring's
-- points can only ever buy back a Ring, never a Coat. Withdrawing spends
-- points (same tier-cost math compositionPointValue already uses) for a
-- fresh item of the CALLER-CHOSEN template within that slot_type, at
-- whatever composition tier the points afford -- not necessarily the same
-- template that was deposited, since the pool tracks no per-template identity
-- at all (unlike warehouse_items).
begin;

alter table public.characters
  add column if not exists gear_composition_points jsonb not null
  default '{"weapon":0,"ring":0,"necklace":0,"boots":0,"hat":0,"coat":0}'::jsonb;

-- ============================================================================
-- deposit_item_as_composition: destroys a gear item, cashing only its own
-- composition_level into the pool matching its slot_type. An item with no
-- composition (level 0) is rejected outright rather than silently destroyed
-- for 0 points -- same protective guard composition_feed's own
-- 'no_points_contributed' error already gives fuel with no value.
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

  v_points_gained := case
    when v_composition_level <= 0 then 0
    else (10 * (3::numeric ^ (v_composition_level - 1)))::integer
  end;

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
-- withdraw_gear_composition: mint a fresh Normal-quality instance of the
-- caller-chosen template (any template sharing the pool's slot_type -- the
-- pool has no memory of which templates funded it), at the caller-chosen
-- composition_level, spending that tier's point cost from the matching
-- per-slot-type pool.
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
  if composition_level < 0 then
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
  v_cost := case
    when composition_level <= 0 then 0
    else (10 * (3::numeric ^ (composition_level - 1)))::integer
  end;

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
