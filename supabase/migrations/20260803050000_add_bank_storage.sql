-- Bank Storage redesign (confirmed with the user, 2026-08-03).
--
-- Gear's old "Deposit as Item" behavior (deposit_item/warehouse_items) was a
-- bug, not a deliberate design: it silently destroyed a real item's identity
-- into a fungible per-template count token, cashing composition value into
-- points along the way. The user's own framing: a Bank Storage slot should
-- behave exactly like an Inventory slot for that item — no stacking, full
-- identity preserved (quality/level/composition/sockets), no points, no
-- fungibility. This migration adds a genuinely additive "location" flag to
-- item_instances instead — depositing/withdrawing just flips it, the row
-- itself never changes. The OLD deposit_item/withdraw_item/warehouse_items
-- path is left in place, unused (verified empty before this migration),
-- rather than dropped, since nothing was asked to be removed.
--
-- Composition Stones and Meteors/DragonBalls are different: their existing
-- paths (transfer_stone -> warehouse_points; transfer_currency -> the
-- account-wide players.bank_meteors/bank_dragonballs) are NOT bugs, they're a
-- deliberately different mechanic the user wants to KEEP. What they're
-- missing is a second, parallel option: "just store it as a physical,
-- non-fungible unit," exactly the same as loose units already look in
-- Inventory. New per-character "banked count" columns (mirroring
-- meteor_count/dragonball_count and composition_stones exactly, just on the
-- Bank side of the same character row) hold that.
begin;

alter table public.item_instances
  add column location text not null default 'inventory'
  check (location in ('inventory', 'bank'));

alter table public.characters
  add column meteor_bank_count integer not null default 0 check (meteor_bank_count >= 0),
  add column dragonball_bank_count integer not null default 0 check (dragonball_bank_count >= 0),
  add column composition_stones_banked jsonb not null default '{"1":0,"2":0,"3":0,"4":0}'::jsonb;

-- Deposit/withdraw a single gear item into/out of Bank Storage. No cost, no
-- RNG, no points — the item row itself is untouched beyond the flag, same
-- ownership-check shape as every other item-mutating RPC in this codebase.
create or replace function public.deposit_item_to_storage(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_account uuid;
  v_location text;
begin
  select ii.location, c.account_id into v_location, v_owner_account
  from public.item_instances ii
  join public.characters c on c.id = ii.owner_id
  where ii.id = item_id
  for update of ii;

  if v_owner_account is null then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;
  if v_owner_account <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_location = 'bank' then
    return jsonb_build_object('ok', false, 'error', 'already_in_bank');
  end if;

  update public.item_instances set location = 'bank' where id = item_id;

  return jsonb_build_object('ok', true, 'item_id', item_id);
end;
$$;

create or replace function public.withdraw_item_from_storage(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_account uuid;
  v_location text;
begin
  select ii.location, c.account_id into v_location, v_owner_account
  from public.item_instances ii
  join public.characters c on c.id = ii.owner_id
  where ii.id = item_id
  for update of ii;

  if v_owner_account is null then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;
  if v_owner_account <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_location <> 'bank' then
    return jsonb_build_object('ok', false, 'error', 'not_in_bank');
  end if;

  update public.item_instances set location = 'inventory' where id = item_id;

  return jsonb_build_object('ok', true, 'item_id', item_id);
end;
$$;

-- Moves loose Meteor/DragonBall units between a character's own Inventory
-- count and a NEW, separate "banked as an item" count. Deliberately distinct
-- from transfer_currency's players.bank_meteors/bank_dragonballs swap — both
-- counts here stay on the same characters row, no players-table lock needed.
create or replace function public.bank_currency_item(
  character_id uuid,
  currency_type text,
  direction text,
  amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_account uuid;
  v_count integer;
  v_bank_count integer;
begin
  if currency_type not in ('meteor', 'dragonball') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;
  if amount is null or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_owner_account from public.characters where id = character_id for update;

  if v_owner_account is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_owner_account <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if currency_type = 'meteor' then
    select meteor_count, meteor_bank_count into v_count, v_bank_count from public.characters where id = character_id;
  else
    select dragonball_count, dragonball_bank_count into v_count, v_bank_count from public.characters where id = character_id;
  end if;

  if direction = 'deposit' then
    if v_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_count := v_count - amount;
    v_bank_count := v_bank_count + amount;
  else
    if v_bank_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_bank_count := v_bank_count - amount;
    v_count := v_count + amount;
  end if;

  if currency_type = 'meteor' then
    update public.characters set meteor_count = v_count, meteor_bank_count = v_bank_count where id = character_id;
  else
    update public.characters set dragonball_count = v_count, dragonball_bank_count = v_bank_count where id = character_id;
  end if;

  return jsonb_build_object('ok', true, 'count', v_count, 'bank_count', v_bank_count);
end;
$$;

-- Same idea, for one Composition Stone tier — moves between
-- composition_stones[tier] (Inventory-visible) and
-- composition_stones_banked[tier] (Storage-visible). Deliberately distinct
-- from transfer_stone's warehouse_points liquidation.
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
  v_owner_account uuid;
  v_stones jsonb;
  v_banked jsonb;
  v_count integer;
  v_bank_count integer;
  v_key text;
begin
  if tier not in (1, 2, 3, 4) then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;
  if amount is null or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_key := tier::text;

  select account_id, composition_stones, composition_stones_banked
    into v_owner_account, v_stones, v_banked
  from public.characters where id = character_id for update;

  if v_owner_account is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_owner_account <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

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

  update public.characters
    set composition_stones = v_stones, composition_stones_banked = v_banked
  where id = character_id;

  return jsonb_build_object('ok', true, 'stones', v_stones, 'stones_banked', v_banked);
end;
$$;

grant execute on function public.deposit_item_to_storage(uuid) to authenticated;
grant execute on function public.withdraw_item_from_storage(uuid) to authenticated;
grant execute on function public.bank_currency_item(uuid, text, text, integer) to authenticated;
grant execute on function public.bank_stone_item(uuid, integer, text, integer) to authenticated;

commit;
