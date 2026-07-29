-- Warehouse: per-character storage for gear/composition stones (its own 40-slot
-- cap, mirroring Inventory's INVENTORY_SLOT_CAP — enforced client-side, same
-- trust model as Inventory's own cap), plus an account-wide currency bank
-- (gold/meteors/dragonballs shared across all of an account's characters).
--
-- Stones AND composed gear both liquidate into a single per-character "points"
-- balance on deposit (the same point-value formula Composition feeding already
-- uses — see forgeCosts.ts's compositionPointValue, mirrored here) rather than
-- being stored as exact tier-tagged tokens. Withdrawing a stone (or a gear item
-- at a chosen composition tier) spends points at that tier's value. This makes
-- deposited stones/gear fully fungible with each other by point value, not just
-- within their own tier — e.g. depositing 3 tier-1 stones (30 pts) lets you
-- withdraw one tier-2 stone (also 30 pts) instead.
--
-- This file replaces an earlier, not-yet-released version of this migration
-- (drops/recreates below are safe either way — no real player data exists yet).
--
-- players.bank_gold already exists (20260727070000) — this adds its two missing
-- siblings and the actual read/write plumbing.

alter table public.players
  add column if not exists bank_meteors integer not null default 0,
  add column if not exists bank_dragonballs integer not null default 0;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so these are wrapped to stay
-- safely re-runnable against a database that already has them from an earlier
-- partial run of this migration.
do $$ begin
  alter table public.players add constraint players_bank_meteors_check check (bank_meteors >= 0);
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table public.players add constraint players_bank_dragonballs_check check (bank_dragonballs >= 0);
exception
  when duplicate_object then null;
end $$;

-- Defensive re-grant per the established migration gotcha (raw SQL table/column
-- changes don't auto-grant anon/authenticated) — players already has working
-- select/insert/update from its original migration, this is just belt-and-braces.
grant select, insert, update on public.players to authenticated;

-- Per-character Warehouse points balance — the shared currency stones/composed
-- gear liquidate into on deposit, and spend to withdraw a chosen tier. Not
-- slot-based (doesn't count toward WAREHOUSE_SLOT_CAP), same as gold/meteors/
-- dragonballs aren't slot-based. Replaces an earlier warehouse_stones jsonb
-- column (per-tier bucket storage) with this single fungible balance.
alter table public.characters drop column if exists warehouse_stones;
alter table public.characters add column if not exists warehouse_points integer not null default 0;

do $$ begin
  alter table public.characters add constraint characters_warehouse_points_check check (warehouse_points >= 0);
exception
  when duplicate_object then null;
end $$;

-- Per-character warehouse gear tokens — a plain count per template_id. A
-- deposited item's quality/level/composition are all discarded (per CLAUDE.md's
-- identity-destroying bank rule); any composition value it had cashes into
-- warehouse_points (see deposit_item) instead of being preserved on the token.
drop table if exists public.warehouse_items;
create table public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  template_id uuid not null references public.item_templates (id),
  count integer not null default 0 check (count > 0),
  created_at timestamptz not null default now(),
  unique (character_id, template_id)
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
-- its instance identity. Its composition_level (if any) is cashed into
-- warehouse_points at the same point value a stone of that tier would be worth.
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
  v_points_gained integer;
  v_new_count integer;
  v_new_points integer;
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

  -- Same point-value formula as a stone of that tier (see forgeCosts.ts's
  -- compositionPointValue) — 0 for Normal/uncomposed (level <= 0).
  v_points_gained := case
    when v_composition_level <= 0 then 0
    else (10 * (3::numeric ^ (v_composition_level - 1)))::integer
  end;

  insert into public.warehouse_items (character_id, template_id, count)
  values (v_character_id, v_template_id, 1)
  on conflict (character_id, template_id)
  do update set count = warehouse_items.count + 1
  returning count into v_new_count;

  update public.characters
  set warehouse_points = warehouse_points + v_points_gained
  where id = v_character_id
  returning warehouse_points into v_new_points;

  delete from public.item_instances where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'template_id', v_template_id,
    'count', v_new_count,
    'points_gained', v_points_gained,
    'warehouse_points', v_new_points
  );
end;
$$;

revoke all on function public.deposit_item(uuid) from public;
grant execute on function public.deposit_item(uuid) to authenticated;

-- ============================================================================
-- withdraw_item: mint a fresh Normal-quality, level-1 instance of the given
-- template — the caller chooses the composition_level to withdraw it at
-- (spending warehouse_points at that tier's value), independent of whichever
-- tier the deposited copies originally came in at.
-- ============================================================================
create or replace function public.withdraw_item(character_id uuid, template_id uuid, composition_level integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_warehouse_points integer;
  v_count integer;
  v_cost integer;
  v_new_count integer;
  v_new_points integer;
  v_new_item public.item_instances;
begin
  if composition_level < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select account_id, warehouse_points into v_account_id, v_warehouse_points
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
  for update;

  if not found or v_count <= 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_cost := case
    when composition_level <= 0 then 0
    else (10 * (3::numeric ^ (composition_level - 1)))::integer
  end;

  if v_warehouse_points < v_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_points', 'required', v_cost, 'owned', v_warehouse_points);
  end if;

  if v_count = 1 then
    delete from public.warehouse_items
    where warehouse_items.character_id = withdraw_item.character_id
      and warehouse_items.template_id = withdraw_item.template_id;
    v_new_count := 0;
  else
    update public.warehouse_items
    set count = count - 1
    where warehouse_items.character_id = withdraw_item.character_id
      and warehouse_items.template_id = withdraw_item.template_id;
    v_new_count := v_count - 1;
  end if;

  update public.characters
  set warehouse_points = warehouse_points - v_cost
  where id = character_id
  returning warehouse_points into v_new_points;

  insert into public.item_instances (owner_id, template_id, composition_level)
  values (character_id, template_id, composition_level)
  returning * into v_new_item;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_new_item),
    'warehouse_count', v_new_count,
    'warehouse_points', v_new_points
  );
end;
$$;

revoke all on function public.withdraw_item(uuid, uuid, integer) from public;
grant execute on function public.withdraw_item(uuid, uuid, integer) to authenticated;

-- ============================================================================
-- transfer_stone: move composition stones between Inventory (composition_stones)
-- and the Warehouse's points balance — depositing a tier-N stone adds its point
-- value, withdrawing one spends the same amount.
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

  select account_id, composition_stones, warehouse_points
  into v_account_id, v_stones, v_warehouse_points
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

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

  update public.characters
  set composition_stones = v_stones, warehouse_points = v_warehouse_points
  where id = character_id;

  return jsonb_build_object('ok', true, 'stones', v_stones, 'warehouse_points', v_warehouse_points);
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
