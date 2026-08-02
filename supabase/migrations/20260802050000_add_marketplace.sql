-- Marketplace + Mail (confirmed with the user, 2026-08-02) -- lets a
-- character list an owned gear item for sale, priced in Gold or Ascension
-- Points (see 20260802040000_add_ascension_points.sql), for a chosen time
-- window, paying a 5% listing fee up front (forfeited regardless of
-- outcome -- same "cost is spent regardless of outcome" precedent as
-- Forge's Quality/Level Upgrade). Other accounts can browse and buy.
--
-- This is the first genuinely cross-account-readable feature in this
-- project -- every prior table has been scoped strictly to the owning
-- account. marketplace_listings' own RLS policy is the main place that
-- changes: active listings are visible to every authenticated account, not
-- just the owner's. item_instances also gets one small additive policy (see
-- below) -- its existing owner-only policy is untouched, but without a
-- second policy a buyer's client could never actually see what an active
-- listing is selling (name/quality/level/stats), since item_instances' RLS
-- predates this feature and was never meant to allow cross-account reads at
-- all. Postgres combines multiple permissive SELECT policies with OR, so
-- this is purely additive -- every existing access path is unchanged.
--
-- Escrow model: a listed item's item_instances.owner_id never changes while
-- the listing is active -- it's simply filtered out of the seller's
-- Inventory grid client-side (useMarketplaceStore.isListed), the exact same
-- "hide via a filter, no extra bookkeeping" pattern already established for
-- equipped items (see CLAUDE.md's Inventory section). Ownership only
-- actually transfers, atomically, at the moment of sale.
--
-- Mail: a lightweight delivery inbox. A bought item lands here (still truly
-- owned by the buyer already -- claiming just stops hiding it, no new
-- item_instances row needed). An unsold/expired or manually cancelled
-- listing's item returns here for the seller to reclaim. Mail never carries
-- currency -- sale proceeds credit the seller's wallet directly and
-- instantly in the same transaction as the sale.
--
-- Neither table needs a service_role grant -- nothing here is ever touched
-- by a service-role client (resolve-combat). Every mutation goes through a
-- SECURITY DEFINER function running as its owner, same as Warehouse/Forge/
-- Sell -- calling this out explicitly since CLAUDE.md documents this exact
-- grant gotcha being missed twice already (resolve-combat's own tables, then
-- Achievements' tables).
begin;

-- ============================================================================
-- marketplace_listings
-- ============================================================================
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  seller_character_id uuid not null references public.characters (id) on delete cascade,
  item_id uuid not null references public.item_instances (id) on delete cascade,
  price_currency text not null check (price_currency in ('gold', 'ascension_points')),
  price_amount integer not null check (price_amount > 0),
  fee_amount integer not null check (fee_amount >= 0),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled', 'expired')),
  buyer_character_id uuid references public.characters (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sold_at timestamptz
);

alter table public.marketplace_listings enable row level security;

-- Active listings are the public browse feed -- visible to every
-- authenticated account, not just the seller's. A seller/buyer can always
-- see their own listings regardless of status, for history.
do $$ begin
  create policy "Active listings are browsable, own listings always visible"
    on public.marketplace_listings for select
    using (
      status = 'active'
      or exists (
        select 1 from public.characters c
        where c.id = marketplace_listings.seller_character_id and c.account_id = auth.uid()
      )
      or exists (
        select 1 from public.characters c
        where c.id = marketplace_listings.buyer_character_id and c.account_id = auth.uid()
      )
    );
exception when duplicate_object then null;
end $$;

-- No insert/update/delete grant at all -- every mutation happens through the
-- SECURITY DEFINER functions below.
grant select on public.marketplace_listings to authenticated;

-- Additive: a second permissive SELECT policy on the existing item_instances
-- table (its own owner-only policy from 20260727070000_add_character_slots.sql
-- is untouched) -- an item currently referenced by an active listing is
-- publicly viewable, so a browsing buyer can actually see what they'd be
-- buying. Read-only, and only ever true for an item its own owner already
-- chose to make public by listing it.
do $$ begin
  create policy "Actively listed items are publicly viewable"
    on public.item_instances for select
    using (
      exists (
        select 1 from public.marketplace_listings ml
        where ml.item_id = item_instances.id and ml.status = 'active'
      )
    );
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- mail: recipient-scoped delivery inbox. reason gives the UI enough context
-- to label each entry without needing a separate kind discriminator, since
-- every row here is always an item (never currency -- see file header).
-- ============================================================================
create table if not exists public.mail (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  item_id uuid not null references public.item_instances (id) on delete cascade,
  reason text not null check (reason in ('purchase', 'listing_cancelled', 'listing_expired')),
  created_at timestamptz not null default now()
);

alter table public.mail enable row level security;

do $$ begin
  create policy "Characters can view their own mail"
    on public.mail for select
    using (exists (select 1 from public.characters c where c.id = mail.character_id and c.account_id = auth.uid()));
exception when duplicate_object then null;
end $$;

grant select on public.mail to authenticated;

-- ============================================================================
-- create_marketplace_listing: lists an owned, unequipped, not-already-listed
-- item for sale. Deducts a 5% fee (ceil, so any positive price has a
-- nonzero fee) from the seller's own balance in the listing's currency up
-- front -- forfeited regardless of outcome, matching Forge's own "cost is
-- spent regardless of outcome" precedent.
-- ============================================================================
create or replace function public.create_marketplace_listing(
  p_character_id uuid,
  p_item_id uuid,
  p_price_currency text,
  p_price_amount integer,
  p_duration_hours integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owner_id uuid;
  v_fee integer;
  v_balance integer;
  v_new_balance integer;
  v_listing_id uuid;
begin
  if p_price_currency not in ('gold', 'ascension_points') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;
  if p_price_amount is null or p_price_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_price');
  end if;
  if p_duration_hours is null or p_duration_hours < 1 or p_duration_hours > 168 then
    return jsonb_build_object('ok', false, 'error', 'invalid_duration');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id for update;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select owner_id into v_owner_id from public.item_instances where id = p_item_id for update;
  if v_owner_id is null or v_owner_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_item_owner');
  end if;

  if exists (
    select 1 from public.characters
    where id = p_character_id
      and (
        equipped_weapon_id = p_item_id or equipped_ring_id = p_item_id or equipped_necklace_id = p_item_id
        or equipped_boots_id = p_item_id or equipped_hat_id = p_item_id or equipped_coat_id = p_item_id
        or equipped_quiver_id = p_item_id
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'item_equipped');
  end if;

  if exists (select 1 from public.marketplace_listings where item_id = p_item_id and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'already_listed');
  end if;

  if exists (select 1 from public.mail where item_id = p_item_id) then
    return jsonb_build_object('ok', false, 'error', 'item_in_mail');
  end if;

  v_fee := ceil(p_price_amount * 0.05);

  if p_price_currency = 'gold' then
    select gold into v_balance from public.characters where id = p_character_id;
    if v_balance < v_fee then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'fee', v_fee);
    end if;
    update public.characters set gold = gold - v_fee where id = p_character_id returning gold into v_new_balance;
  else
    select ascension_points into v_balance from public.characters where id = p_character_id;
    if v_balance < v_fee then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ascension_points', 'fee', v_fee);
    end if;
    update public.characters set ascension_points = ascension_points - v_fee where id = p_character_id
    returning ascension_points into v_new_balance;
  end if;

  insert into public.marketplace_listings
    (seller_character_id, item_id, price_currency, price_amount, fee_amount, status, expires_at)
  values
    (p_character_id, p_item_id, p_price_currency, p_price_amount, v_fee, 'active', now() + (p_duration_hours || ' hours')::interval)
  returning id into v_listing_id;

  return jsonb_build_object(
    'ok', true,
    'listing_id', v_listing_id,
    'fee', v_fee,
    'gold', case when p_price_currency = 'gold' then v_new_balance else null end,
    'ascension_points', case when p_price_currency = 'ascension_points' then v_new_balance else null end
  );
end;
$$;

revoke all on function public.create_marketplace_listing(uuid, uuid, text, integer, integer) from public;
grant execute on function public.create_marketplace_listing(uuid, uuid, text, integer, integer) to authenticated;

-- ============================================================================
-- buy_marketplace_listing: atomically moves currency buyer->seller and
-- ownership seller->buyer, then mails the item to the buyer. Locks both
-- characters rows in a fixed order (by id) to avoid deadlocking against a
-- concurrent purchase touching the same two characters in the opposite
-- order.
-- ============================================================================
create or replace function public.buy_marketplace_listing(p_character_id uuid, p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_account_id uuid;
  v_seller_character_id uuid;
  v_item_id uuid;
  v_status text;
  v_expires_at timestamptz;
  v_price_currency text;
  v_price_amount integer;
  v_buyer_balance integer;
  v_new_buyer_balance integer;
begin
  select account_id into v_buyer_account_id from public.characters where id = p_character_id;
  if v_buyer_account_id is null or v_buyer_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select seller_character_id, item_id, status, expires_at, price_currency, price_amount
  into v_seller_character_id, v_item_id, v_status, v_expires_at, v_price_currency, v_price_amount
  from public.marketplace_listings
  where id = p_listing_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'not_active');
  end if;

  if v_seller_character_id = p_character_id then
    return jsonb_build_object('ok', false, 'error', 'own_listing');
  end if;

  if now() >= v_expires_at then
    update public.marketplace_listings set status = 'expired' where id = p_listing_id;
    insert into public.mail (character_id, item_id, reason) values (v_seller_character_id, v_item_id, 'listing_expired');
    return jsonb_build_object('ok', false, 'error', 'listing_expired');
  end if;

  perform 1 from public.characters where id in (p_character_id, v_seller_character_id) order by id for update;

  if v_price_currency = 'gold' then
    select gold into v_buyer_balance from public.characters where id = p_character_id;
    if v_buyer_balance < v_price_amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gold');
    end if;
    update public.characters set gold = gold - v_price_amount where id = p_character_id returning gold into v_new_buyer_balance;
    update public.characters set gold = gold + v_price_amount where id = v_seller_character_id;
  else
    select ascension_points into v_buyer_balance from public.characters where id = p_character_id;
    if v_buyer_balance < v_price_amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ascension_points');
    end if;
    update public.characters set ascension_points = ascension_points - v_price_amount where id = p_character_id
    returning ascension_points into v_new_buyer_balance;
    update public.characters set ascension_points = ascension_points + v_price_amount where id = v_seller_character_id;
  end if;

  update public.item_instances set owner_id = p_character_id where id = v_item_id;

  update public.marketplace_listings
    set status = 'sold', buyer_character_id = p_character_id, sold_at = now()
    where id = p_listing_id;

  insert into public.mail (character_id, item_id, reason) values (p_character_id, v_item_id, 'purchase');

  return jsonb_build_object(
    'ok', true,
    'gold', case when v_price_currency = 'gold' then v_new_buyer_balance else null end,
    'ascension_points', case when v_price_currency = 'ascension_points' then v_new_buyer_balance else null end
  );
end;
$$;

revoke all on function public.buy_marketplace_listing(uuid, uuid) from public;
grant execute on function public.buy_marketplace_listing(uuid, uuid) to authenticated;

-- ============================================================================
-- end_marketplace_listing: seller-triggered, covers both an early manual
-- cancel and reclaiming an already-expired listing -- the only difference is
-- whether now() is past expires_at at the moment this runs, which decides
-- the stored status for history. The fee is never refunded either way (paid
-- up front at listing time, already spent).
-- ============================================================================
create or replace function public.end_marketplace_listing(p_character_id uuid, p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_seller_character_id uuid;
  v_item_id uuid;
  v_status text;
  v_expires_at timestamptz;
  v_new_status text;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select seller_character_id, item_id, status, expires_at
  into v_seller_character_id, v_item_id, v_status, v_expires_at
  from public.marketplace_listings
  where id = p_listing_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_seller_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_seller');
  end if;

  if v_status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'not_active');
  end if;

  v_new_status := case when now() >= v_expires_at then 'expired' else 'cancelled' end;

  update public.marketplace_listings set status = v_new_status where id = p_listing_id;

  insert into public.mail (character_id, item_id, reason)
  values (p_character_id, v_item_id, case when v_new_status = 'expired' then 'listing_expired' else 'listing_cancelled' end);

  return jsonb_build_object('ok', true, 'status', v_new_status);
end;
$$;

revoke all on function public.end_marketplace_listing(uuid, uuid) from public;
grant execute on function public.end_marketplace_listing(uuid, uuid) to authenticated;

-- ============================================================================
-- claim_mail: the item's owner_id is already correct by the time it's in
-- Mail (set at purchase time, or never changed for a returned listing) --
-- claiming just stops hiding it, no item_instances mutation needed.
-- ============================================================================
create or replace function public.claim_mail(p_character_id uuid, p_mail_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_mail_character_id uuid;
  v_item_id uuid;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id into v_mail_character_id, v_item_id from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  delete from public.mail where id = p_mail_id;

  return jsonb_build_object('ok', true, 'item_id', v_item_id);
end;
$$;

revoke all on function public.claim_mail(uuid, uuid) from public;
grant execute on function public.claim_mail(uuid, uuid) to authenticated;

commit;
