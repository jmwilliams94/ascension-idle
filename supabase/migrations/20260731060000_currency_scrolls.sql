-- Stage 2 of the Bank/Warehouse economy redesign (see CLAUDE.md's Accounts &
-- Characters -> Warehouse note, and stage 1's migration
-- 20260731050000_meteor_dragonball_inventory_items.sql). Meteor Scroll /
-- DragonBall Scroll: bundle 10 loose Meteors/DragonBalls into 1 Scroll (its
-- own non-stacking Inventory item, same "one tile per unit" convention as
-- Meteors/DragonBalls/Stones) for more compact storage, and unbundle back
-- into 10 loose units on demand.
--
-- Confirmed with the user: unbundling is all-or-nothing -- it requires 10
-- free Inventory slots up front (checked server-side, mirroring the same
-- occupied-slot-count formula used elsewhere) and simply fails with
-- 'not_enough_room' if there isn't space, rather than partially granting and
-- overflowing the rest to Loot Holding the way a kill-drop would.
begin;

alter table public.characters
  add column if not exists meteor_scroll_count integer not null default 0,
  add column if not exists dragonball_scroll_count integer not null default 0;

do $$ begin
  alter table public.characters add constraint characters_meteor_scroll_count_check check (meteor_scroll_count >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.characters add constraint characters_dragonball_scroll_count_check check (dragonball_scroll_count >= 0);
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- bundle_currency_scroll: 10 loose units -> 1 Scroll. One fixed-size
-- transaction per call (mirrors buyArrows/buyPotions always purchasing one
-- full stack, not a variable amount) -- click again to bundle another 10.
-- ============================================================================
create or replace function public.bundle_currency_scroll(character_id uuid, currency_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_unit_count integer;
  v_scroll_count integer;
begin
  if currency_type not in ('meteor', 'dragonball') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select account_id into v_account_id from public.characters where id = character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if currency_type = 'meteor' then
    select meteor_count into v_unit_count from public.characters where id = character_id;
  else
    select dragonball_count into v_unit_count from public.characters where id = character_id;
  end if;

  if v_unit_count < 10 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_units', 'owned', v_unit_count);
  end if;

  if currency_type = 'meteor' then
    update public.characters
    set meteor_count = meteor_count - 10, meteor_scroll_count = meteor_scroll_count + 1
    where id = character_id
    returning meteor_count, meteor_scroll_count into v_unit_count, v_scroll_count;
  else
    update public.characters
    set dragonball_count = dragonball_count - 10, dragonball_scroll_count = dragonball_scroll_count + 1
    where id = character_id
    returning dragonball_count, dragonball_scroll_count into v_unit_count, v_scroll_count;
  end if;

  return jsonb_build_object('ok', true, 'currency_type', currency_type, 'unit_count', v_unit_count, 'scroll_count', v_scroll_count);
end;
$$;

grant execute on function public.bundle_currency_scroll(uuid, text) to authenticated;

-- ============================================================================
-- unbundle_currency_scroll: 1 Scroll -> 10 loose units. All-or-nothing --
-- requires 10 free Inventory slots (occupied-slot-count mirrors
-- useInventoryStore.occupiedSlotCount/resolve-combat's own copy: gear +
-- stones + potions + Meteors/DragonBalls + Scrolls, out of 40) or the whole
-- call fails and nothing is consumed.
-- ============================================================================
create or replace function public.unbundle_currency_scroll(character_id uuid, currency_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_scroll_count integer;
  v_unit_count integer;
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_meteor_count integer;
  v_dragonball_count integer;
  v_meteor_scroll_count integer;
  v_dragonball_scroll_count integer;
  v_occupied integer;
begin
  if currency_type not in ('meteor', 'dragonball') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select account_id,
         meteor_count, dragonball_count,
         meteor_scroll_count, dragonball_scroll_count
  into v_account_id, v_meteor_count, v_dragonball_count, v_meteor_scroll_count, v_dragonball_scroll_count
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_scroll_count := case when currency_type = 'meteor' then v_meteor_scroll_count else v_dragonball_scroll_count end;

  if v_scroll_count < 1 then
    return jsonb_build_object('ok', false, 'error', 'no_scrolls');
  end if;

  select count(*) into v_gear_count from public.item_instances where owner_id = character_id;

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from public.characters, jsonb_each_text(composition_stones)
  where id = character_id;

  -- Qualified against the function's own parameter name (potion_stacks has its
  -- own character_id column, which would otherwise be ambiguous against this
  -- function's identically-named parameter).
  select count(*) into v_potion_count
  from public.potion_stacks ps
  where ps.character_id = unbundle_currency_scroll.character_id and ps.count > 0;

  v_occupied := v_gear_count + v_stone_count + v_potion_count
    + v_meteor_count + v_dragonball_count + v_meteor_scroll_count + v_dragonball_scroll_count;

  if v_occupied + 10 > 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room', 'occupied', v_occupied);
  end if;

  if currency_type = 'meteor' then
    update public.characters
    set meteor_count = meteor_count + 10, meteor_scroll_count = meteor_scroll_count - 1
    where id = character_id
    returning meteor_count, meteor_scroll_count into v_unit_count, v_scroll_count;
  else
    update public.characters
    set dragonball_count = dragonball_count + 10, dragonball_scroll_count = dragonball_scroll_count - 1
    where id = character_id
    returning dragonball_count, dragonball_scroll_count into v_unit_count, v_scroll_count;
  end if;

  return jsonb_build_object('ok', true, 'currency_type', currency_type, 'unit_count', v_unit_count, 'scroll_count', v_scroll_count);
end;
$$;

grant execute on function public.unbundle_currency_scroll(uuid, text) to authenticated;

commit;
