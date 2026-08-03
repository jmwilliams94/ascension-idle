-- Bank tab rework, part 1: account-wide Storage (confirmed with the user,
-- 2026-08-03). Both the physical Bank Storage system (item_instances.location,
-- meteor_bank_count/dragonball_bank_count, composition_stones_banked — added
-- 20260803050000) and the points-liquidation system (warehouse_points,
-- gear_composition_points — added 20260729020000/20260731080000) move from
-- `characters` to `players`, mirroring 20260803000000_ascension_points_
-- account_wide.sql's exact pattern. `composition_stones` (the *unbanked*
-- per-character stone count that feeds the Forge) is untouched.
--
-- Also removes the dead legacy "fungible token" system outright (warehouse_
-- items table, deposit_item/withdraw_item) — confirmed empty in the live DB,
-- no UI writes into it anymore since the Bank Storage redesign superseded it.
begin;

-- ============================================================================
-- 1. Schema: add the 5 columns to players, backfill by summing across each
--    account's characters, drop them from characters.
-- ============================================================================
alter table public.players
  add column if not exists warehouse_points integer not null default 0,
  add column if not exists gear_composition_points jsonb not null
    default '{"weapon":0,"ring":0,"necklace":0,"boots":0,"hat":0,"coat":0}'::jsonb,
  add column if not exists meteor_bank_count integer not null default 0,
  add column if not exists dragonball_bank_count integer not null default 0,
  add column if not exists composition_stones_banked jsonb not null
    default '{"1":0,"2":0,"3":0,"4":0}'::jsonb;

do $$ begin
  alter table public.players add constraint players_warehouse_points_check check (warehouse_points >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.players add constraint players_meteor_bank_count_check check (meteor_bank_count >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.players add constraint players_dragonball_bank_count_check check (dragonball_bank_count >= 0);
exception when duplicate_object then null;
end $$;

-- Plain integer columns: simple sum backfill, same as ascension_points.
update public.players p
set
  warehouse_points = coalesce((select sum(c.warehouse_points) from public.characters c where c.account_id = p.id), 0),
  meteor_bank_count = coalesce((select sum(c.meteor_bank_count) from public.characters c where c.account_id = p.id), 0),
  dragonball_bank_count = coalesce((select sum(c.dragonball_bank_count) from public.characters c where c.account_id = p.id), 0);

-- jsonb columns: sum each key across every character on the account, so
-- nothing already-banked under the old per-character model is lost.
update public.players p
set gear_composition_points = (
  select jsonb_object_agg(slot, total)
  from (
    select key as slot, sum((value)::integer) as total
    from public.characters c, jsonb_each_text(c.gear_composition_points)
    where c.account_id = p.id
    group by key
  ) sums
)
where exists (select 1 from public.characters c where c.account_id = p.id);

update public.players p
set composition_stones_banked = (
  select jsonb_object_agg(tier, total)
  from (
    select key as tier, sum((value)::integer) as total
    from public.characters c, jsonb_each_text(c.composition_stones_banked)
    where c.account_id = p.id
    group by key
  ) sums
)
where exists (select 1 from public.characters c where c.account_id = p.id);

alter table public.characters
  drop column if exists warehouse_points,
  drop column if exists gear_composition_points,
  drop column if exists meteor_bank_count,
  drop column if exists dragonball_bank_count,
  drop column if exists composition_stones_banked;

-- ============================================================================
-- 2. Remove the dead legacy token system entirely.
-- ============================================================================
drop function if exists public.deposit_item(uuid);
drop function if exists public.withdraw_item(uuid, uuid, integer);
drop table if exists public.warehouse_items;

-- ============================================================================
-- 3. transfer_stone: warehouse_points moves to players.
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
  v_warehouse_points integer;
  v_tier_key text;
  v_owned integer;
  v_point_value integer;
  v_cost integer;
begin
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if tier < 1 or tier > 4 or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select account_id, composition_stones into v_account_id, v_stones
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select warehouse_points into v_warehouse_points from public.players where id = v_account_id for update;

  v_tier_key := tier::text;
  v_point_value := (10 * (3::numeric ^ (tier - 1)))::integer;

  if direction = 'deposit' then
    v_owned := coalesce((v_stones ->> v_tier_key)::integer, 0);
    if v_owned < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_stones', 'owned', v_owned, 'requested', amount);
    end if;
    v_stones := jsonb_set(v_stones, array[v_tier_key], to_jsonb(v_owned - amount));
    v_warehouse_points := v_warehouse_points + amount * v_point_value;
  else
    v_cost := amount * v_point_value;
    if v_warehouse_points < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_points', 'required', v_cost, 'owned', v_warehouse_points);
    end if;
    v_warehouse_points := v_warehouse_points - v_cost;
    v_stones := jsonb_set(v_stones, array[v_tier_key], to_jsonb(coalesce((v_stones ->> v_tier_key)::integer, 0) + amount));
  end if;

  update public.characters set composition_stones = v_stones where id = character_id;
  update public.players set warehouse_points = v_warehouse_points where id = v_account_id;

  return jsonb_build_object('ok', true, 'stones', v_stones, 'warehouse_points', v_warehouse_points);
end;
$$;

revoke all on function public.transfer_stone(uuid, integer, integer, text) from public;
grant execute on function public.transfer_stone(uuid, integer, integer, text) to authenticated;

-- ============================================================================
-- 4. deposit_item_as_composition / withdraw_gear_composition:
--    gear_composition_points moves to players.
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

  select account_id into v_account_id from public.characters where id = v_character_id;

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
  if composition_level < 0 then
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
  v_cost := case
    when composition_level <= 0 then 0
    else (10 * (3::numeric ^ (composition_level - 1)))::integer
  end;

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

-- ============================================================================
-- 5. bank_currency_item: meteor_bank_count/dragonball_bank_count move to
--    players.
-- ============================================================================
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
  v_account_id uuid;
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

  select account_id into v_account_id from public.characters where id = character_id for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if currency_type = 'meteor' then
    select meteor_count into v_count from public.characters where id = character_id;
    select meteor_bank_count into v_bank_count from public.players where id = v_account_id for update;
  else
    select dragonball_count into v_count from public.characters where id = character_id;
    select dragonball_bank_count into v_bank_count from public.players where id = v_account_id for update;
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
    update public.characters set meteor_count = v_count where id = character_id;
    update public.players set meteor_bank_count = v_bank_count where id = v_account_id;
  else
    update public.characters set dragonball_count = v_count where id = character_id;
    update public.players set dragonball_bank_count = v_bank_count where id = v_account_id;
  end if;

  return jsonb_build_object('ok', true, 'count', v_count, 'bank_count', v_bank_count);
end;
$$;

revoke all on function public.bank_currency_item(uuid, text, text, integer) from public;
grant execute on function public.bank_currency_item(uuid, text, text, integer) to authenticated;

-- ============================================================================
-- 6. bank_stone_item: composition_stones_banked moves to players.
--    composition_stones (unbanked) stays on characters, untouched.
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

-- ============================================================================
-- 7. withdraw_item_from_storage: gains p_character_id, the recipient claiming
--    the item — this is the piece that makes withdrawal genuinely
--    account-wide rather than "must return to whichever character deposited
--    it." Ownership is verified two ways: the item's own (original) owning
--    character must belong to the caller's account, AND the requested
--    recipient character must also belong to the caller's account.
--    deposit_item_to_storage is unchanged — depositing still just flips
--    location on the item's current owner.
--
-- CREATE OR REPLACE cannot change a function's parameter list -- Postgres
-- would just create a second (item_id uuid, p_character_id uuid) overload
-- alongside the old (item_id uuid) one, the same "cannot change name/number
-- of input parameters" gotcha already documented on
-- unlock_next_achievement_tier. Drop the old single-parameter version first.
-- ============================================================================
drop function if exists public.withdraw_item_from_storage(uuid);

create or replace function public.withdraw_item_from_storage(item_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_account uuid;
  v_location text;
  v_recipient_account uuid;
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

  select account_id into v_recipient_account from public.characters where id = p_character_id;

  if v_recipient_account is null or v_recipient_account <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'invalid_recipient');
  end if;

  update public.item_instances set location = 'inventory', owner_id = p_character_id where id = item_id;

  return jsonb_build_object('ok', true, 'item_id', item_id);
end;
$$;

revoke all on function public.withdraw_item_from_storage(uuid, uuid) from public;
grant execute on function public.withdraw_item_from_storage(uuid, uuid) to authenticated;

commit;
