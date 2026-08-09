-- Fix: "Bank" on a composition'd gear item (deposit_item_as_composition) and
-- withdrawing gear via composition points (withdraw_gear_composition) both
-- failed unconditionally with a generic RPC error -- reported by the user as
-- "Banking of +1 items into the composition gears doesn't seem to work. It
-- just says couldn't bank that item."
--
-- Root cause: gear_composition_points is an account-wide pool that lives on
-- players (moved there from characters by 20260803080000_bank_account_wide.sql
-- -- see CLAUDE.md's Account-level players fields list, and
-- usePlayerRecordStore.ts, which has only ever read/written it via the
-- players row). But 20260811040000_composition_points_real_values.sql's
-- create-or-replace of these two functions was apparently based on an older
-- pre-account-wide copy -- it reads/writes `characters.gear_composition_points`,
-- a column that was never re-added to characters and doesn't exist there.
-- Every call hit a plain "column does not exist" Postgres error, surfaced to
-- the client as a generic failure -- unconditional, not actually specific to
-- +1 items (composition_level 0 items can't even reach this RPC, since the
-- Bank button is hidden for composition_level = 0, so a +1 item was simply
-- the first case any player could ever hit).
--
-- Fix: restore both functions to the players-scoped shape from
-- 20260803080000_bank_account_wide.sql, keeping 20260811040000's real
-- composition_point_value() helper and +12 cap (both correct, not regressed).
begin;

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

  select account_id into v_account_id from public.characters where id = v_character_id;

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

  select gear_composition_points into v_points from public.players where id = v_account_id for update;
  v_points := jsonb_set(v_points, array[v_slot_type], to_jsonb(coalesce((v_points ->> v_slot_type)::integer, 0) + v_points_gained));
  update public.players set gear_composition_points = v_points where id = v_account_id;

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

  select account_id into v_account_id from public.characters where id = character_id;

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

  select gear_composition_points into v_points from public.players where id = v_account_id for update;

  v_owned := coalesce((v_points ->> v_slot_type)::integer, 0);
  v_cost := public.composition_point_value(composition_level);

  if v_owned < v_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_points', 'required', v_cost, 'owned', v_owned);
  end if;

  v_points := jsonb_set(v_points, array[v_slot_type], to_jsonb(v_owned - v_cost));
  update public.players set gear_composition_points = v_points where id = v_account_id;

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
