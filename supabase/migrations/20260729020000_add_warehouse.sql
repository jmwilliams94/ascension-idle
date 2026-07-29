-- Warehouse: per-character storage for gear/composition stones (its own 40-slot
-- cap, exactly mirroring Inventory's INVENTORY_SLOT_CAP — enforced client-side,
-- same trust model as Inventory's own cap), plus an account-wide currency bank
-- (gold/meteors/dragonballs shared across all of an account's characters).
-- players.bank_gold already exists (20260727070000) — this adds its two missing
-- siblings and the actual read/write plumbing.

alter table public.players
  add column if not exists bank_meteors integer not null default 0,
  add column if not exists bank_dragonballs integer not null default 0;

alter table public.players add constraint players_bank_meteors_check check (bank_meteors >= 0);
alter table public.players add constraint players_bank_dragonballs_check check (bank_dragonballs >= 0);

-- Defensive re-grant per the established migration gotcha (raw SQL table/column
-- changes don't auto-grant anon/authenticated) — players already has working
-- select/insert/update from its original migration, this is just belt-and-braces.
grant select, insert, update on public.players to authenticated;

-- Per-character warehouse stones — identical shape/semantics to
-- characters.composition_stones, just a second bucket. Same trust model: never
-- written by the generic autosave, mutated only by transfer_stone below.
alter table public.characters
  add column if not exists warehouse_stones jsonb not null default '{"1": 0, "2": 0, "3": 0, "4": 0}'::jsonb;

-- Per-character warehouse gear tokens. A deposited item's original instance is
-- destroyed (per CLAUDE.md's identity-destroying bank rule) and collapses into a
-- count per (template_id, composition_level) pair — fully fungible once
-- deposited, occupying exactly one Warehouse slot regardless of count (same as
-- how one arrow stack occupies one Inventory slot regardless of its count).
create table if not exists public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  template_id uuid not null references public.item_templates (id),
  composition_level integer not null default 0,
  count integer not null default 0 check (count > 0),
  created_at timestamptz not null default now(),
  unique (character_id, template_id, composition_level)
);

alter table public.warehouse_items enable row level security;

create policy "Characters can view their own warehouse items"
  on public.warehouse_items for select
  using (exists (select 1 from public.characters c where c.id = warehouse_items.character_id and c.account_id = auth.uid()));

-- No insert/update/delete grant — deliberately stricter than item_instances.
-- Every mutation goes through deposit_item/withdraw_item (SECURITY DEFINER,
-- bypasses grants as the function owner), so the client never has a direct write
-- path at all, not even one that's merely unused in the app's own code.
grant select on public.warehouse_items to authenticated;

-- ============================================================================
-- deposit_item: move a gear item from Inventory into the Warehouse, destroying
-- its instance identity (only template_id + composition_level survive).
-- ============================================================================
create or replace function public.deposit_item(item_id uuid)
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
  v_new_count integer;
begin
  select owner_id, template_id, composition_level into v_character_id, v_template_id, v_composition_level
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  insert into public.warehouse_items (character_id, template_id, composition_level, count)
  values (v_character_id, v_template_id, v_composition_level, 1)
  on conflict (character_id, template_id, composition_level)
  do update set count = warehouse_items.count + 1
  returning count into v_new_count;

  delete from public.item_instances where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'template_id', v_template_id,
    'composition_level', v_composition_level,
    'count', v_new_count
  );
end;
$$;

revoke all on function public.deposit_item(uuid) from public;
grant execute on function public.deposit_item(uuid) to authenticated;

-- ============================================================================
-- withdraw_item: mint a fresh Normal-quality, level-1 instance of the given
-- template+tier from the Warehouse — never the original instance back.
-- ============================================================================
create or replace function public.withdraw_item(character_id uuid, template_id uuid, composition_level integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_count integer;
  v_new_item public.item_instances;
begin
  select account_id into v_account_id
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select count into v_count
  from public.warehouse_items
  where warehouse_items.character_id = withdraw_item.character_id
    and warehouse_items.template_id = withdraw_item.template_id
    and warehouse_items.composition_level = withdraw_item.composition_level
  for update;

  if not found or v_count <= 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_count = 1 then
    delete from public.warehouse_items
    where warehouse_items.character_id = withdraw_item.character_id
      and warehouse_items.template_id = withdraw_item.template_id
      and warehouse_items.composition_level = withdraw_item.composition_level;
    v_count := 0;
  else
    update public.warehouse_items
    set count = count - 1
    where warehouse_items.character_id = withdraw_item.character_id
      and warehouse_items.template_id = withdraw_item.template_id
      and warehouse_items.composition_level = withdraw_item.composition_level;
    v_count := v_count - 1;
  end if;

  insert into public.item_instances (owner_id, template_id, composition_level)
  values (character_id, template_id, composition_level)
  returning * into v_new_item;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_new_item),
    'warehouse_count', v_count
  );
end;
$$;

revoke all on function public.withdraw_item(uuid, uuid, integer) from public;
grant execute on function public.withdraw_item(uuid, uuid, integer) to authenticated;

-- ============================================================================
-- transfer_stone: move composition stones between Inventory (composition_stones)
-- and Warehouse (warehouse_stones) for a single tier.
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
  v_warehouse_stones jsonb;
  v_tier_key text;
  v_source_owned integer;
begin
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if tier < 1 or tier > 4 or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select account_id, composition_stones, warehouse_stones
  into v_account_id, v_stones, v_warehouse_stones
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_tier_key := tier::text;

  if direction = 'deposit' then
    v_source_owned := coalesce((v_stones ->> v_tier_key)::integer, 0);
    if v_source_owned < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_stones', 'owned', v_source_owned, 'requested', amount);
    end if;
    v_stones := jsonb_set(v_stones, array[v_tier_key], to_jsonb(v_source_owned - amount));
    v_warehouse_stones := jsonb_set(
      v_warehouse_stones, array[v_tier_key],
      to_jsonb(coalesce((v_warehouse_stones ->> v_tier_key)::integer, 0) + amount)
    );
  else
    v_source_owned := coalesce((v_warehouse_stones ->> v_tier_key)::integer, 0);
    if v_source_owned < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_stones', 'owned', v_source_owned, 'requested', amount);
    end if;
    v_warehouse_stones := jsonb_set(v_warehouse_stones, array[v_tier_key], to_jsonb(v_source_owned - amount));
    v_stones := jsonb_set(
      v_stones, array[v_tier_key],
      to_jsonb(coalesce((v_stones ->> v_tier_key)::integer, 0) + amount)
    );
  end if;

  update public.characters
  set composition_stones = v_stones, warehouse_stones = v_warehouse_stones
  where id = character_id;

  return jsonb_build_object('ok', true, 'stones', v_stones, 'warehouse_stones', v_warehouse_stones);
end;
$$;

revoke all on function public.transfer_stone(uuid, integer, integer, text) from public;
grant execute on function public.transfer_stone(uuid, integer, integer, text) to authenticated;

-- ============================================================================
-- transfer_currency: move gold/meteors/dragonballs between a character's own
-- wallet and the account-wide bank (players.bank_*). Gold is normally
-- client-authoritative, but this specific move must be atomic/server-verified —
-- otherwise a client could increment the bank without ever decrementing the
-- wallet (a currency dupe), since both writes are independently permitted by RLS.
-- ============================================================================
create or replace function public.transfer_currency(character_id uuid, currency text, amount integer, direction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_balance integer;
  v_bank_balance integer;
begin
  if currency not in ('gold', 'meteors', 'dragonballs') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_account_id
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  perform 1 from public.players where id = v_account_id for update;

  if currency = 'gold' then
    select gold into v_character_balance from public.characters where id = character_id;
    select bank_gold into v_bank_balance from public.players where id = v_account_id;
  elsif currency = 'meteors' then
    select meteors into v_character_balance from public.characters where id = character_id;
    select bank_meteors into v_bank_balance from public.players where id = v_account_id;
  else
    select dragonballs into v_character_balance from public.characters where id = character_id;
    select bank_dragonballs into v_bank_balance from public.players where id = v_account_id;
  end if;

  if direction = 'deposit' then
    if v_character_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_character_balance := v_character_balance - amount;
    v_bank_balance := v_bank_balance + amount;
  else
    if v_bank_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_bank_balance := v_bank_balance - amount;
    v_character_balance := v_character_balance + amount;
  end if;

  if currency = 'gold' then
    update public.characters set gold = v_character_balance where id = character_id;
    update public.players set bank_gold = v_bank_balance where id = v_account_id;
  elsif currency = 'meteors' then
    update public.characters set meteors = v_character_balance where id = character_id;
    update public.players set bank_meteors = v_bank_balance where id = v_account_id;
  else
    update public.characters set dragonballs = v_character_balance where id = character_id;
    update public.players set bank_dragonballs = v_bank_balance where id = v_account_id;
  end if;

  return jsonb_build_object('ok', true, 'character_balance', v_character_balance, 'bank_balance', v_bank_balance);
end;
$$;

revoke all on function public.transfer_currency(uuid, text, integer, text) from public;
grant execute on function public.transfer_currency(uuid, text, integer, text) to authenticated;
