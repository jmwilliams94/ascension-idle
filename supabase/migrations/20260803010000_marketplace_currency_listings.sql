-- Marketplace: Meteors/DragonBalls/their Scrolls become listable, alongside
-- gear (confirmed with the user, 2026-08-03). Same shape as
-- marketplace_listings/mail already have for gear (item_id) -- both tables
-- get a nullable currency_type column instead, with exactly one of
-- (item_id, currency_type) set per row, mirroring loot_holding's own
-- item-vs-currency split (20260731050000_meteor_dragonball_inventory_
-- items.sql).
--
-- Escrow model differs from gear's: a listed gear item's owner_id never
-- changes while active (just hidden client-side, see isListed) -- but a
-- currency unit has no per-instance row to hide, so create_marketplace_
-- listing decrements the unit from the seller's own count column immediately
-- (the same "atomic decrement into escrow" shape the Bank/Warehouse currency
-- transfer already uses), returned via Mail (incrementing the count back) if
-- cancelled/expired, or credited to the buyer via Mail (incrementing their
-- own count) if sold -- claim_mail is where that increment actually happens
-- either way, matching claim_loot_holding's own currency branch.
--
-- Always exactly 1 unit per listing (confirmed with the user) -- selling 10
-- means creating 10 separate listings, same as gear (each listing is always
-- exactly 1 "thing," whether that's 1 unique gear item or 1 currency unit).
-- A Scroll is still just 1 unit for this purpose (it happens to represent 10
-- loose units bundled, but that's opaque to the listing itself).
--
-- Also added here: a 20-active-listings cap, account-wide (not per
-- character) -- confirmed with the user. Applies to every listing, not just
-- the new currency ones, so create_marketplace_listing's gear path gains
-- this check too.
begin;

alter table public.marketplace_listings alter column item_id drop not null;
alter table public.marketplace_listings
  add column if not exists currency_type text check (currency_type in ('meteor', 'dragonball', 'meteor_scroll', 'dragonball_scroll'));
alter table public.marketplace_listings
  add constraint marketplace_listings_target_check check ((item_id is not null) <> (currency_type is not null));

alter table public.mail alter column item_id drop not null;
alter table public.mail
  add column if not exists currency_type text check (currency_type in ('meteor', 'dragonball', 'meteor_scroll', 'dragonball_scroll'));
alter table public.mail
  add constraint mail_target_check check ((item_id is not null) <> (currency_type is not null));

-- ============================================================================
-- create_marketplace_listing: gains p_currency_type (nullable, default null
-- to keep this an additive change) -- exactly one of p_item_id/
-- p_currency_type must be provided. All validation (including currency
-- balance) happens via read-only SELECTs before any mutation, same ordering
-- discipline the original gear-only version already had, so an early
-- rejection (e.g. can't afford the fee) never leaves a half-applied escrow
-- deduction behind.
-- ============================================================================
create or replace function public.create_marketplace_listing(
  p_character_id uuid,
  p_item_id uuid,
  p_price_currency text,
  p_price_amount integer,
  p_duration_hours integer,
  p_currency_type text default null
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
  v_active_listing_count integer;
  v_unit_count integer;
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
  if (p_item_id is null) = (p_currency_type is null) then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  if p_currency_type is not null and p_currency_type not in ('meteor', 'dragonball', 'meteor_scroll', 'dragonball_scroll') then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id for update;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select count(*) into v_active_listing_count
  from public.marketplace_listings ml
  join public.characters c on c.id = ml.seller_character_id
  where c.account_id = v_account_id and ml.status = 'active';
  if v_active_listing_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_listings');
  end if;

  if p_item_id is not null then
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
  else
    if p_currency_type = 'meteor' then
      select meteor_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'dragonball' then
      select dragonball_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'meteor_scroll' then
      select meteor_scroll_count into v_unit_count from public.characters where id = p_character_id for update;
    else
      select dragonball_scroll_count into v_unit_count from public.characters where id = p_character_id for update;
    end if;
    if coalesce(v_unit_count, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_currency');
    end if;
  end if;

  v_fee := ceil(p_price_amount * 0.05);

  if p_price_currency = 'gold' then
    select gold into v_balance from public.characters where id = p_character_id;
    if v_balance < v_fee then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'fee', v_fee);
    end if;
  else
    select ascension_points into v_balance from public.players where id = v_account_id for update;
    if v_balance < v_fee then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ascension_points', 'fee', v_fee);
    end if;
  end if;

  -- Every guard has passed -- mutate now.
  if p_price_currency = 'gold' then
    update public.characters set gold = gold - v_fee where id = p_character_id returning gold into v_new_balance;
  else
    update public.players set ascension_points = ascension_points - v_fee where id = v_account_id
    returning ascension_points into v_new_balance;
  end if;

  if p_currency_type is not null then
    if p_currency_type = 'meteor' then
      update public.characters set meteor_count = meteor_count - 1 where id = p_character_id;
    elsif p_currency_type = 'dragonball' then
      update public.characters set dragonball_count = dragonball_count - 1 where id = p_character_id;
    elsif p_currency_type = 'meteor_scroll' then
      update public.characters set meteor_scroll_count = meteor_scroll_count - 1 where id = p_character_id;
    else
      update public.characters set dragonball_scroll_count = dragonball_scroll_count - 1 where id = p_character_id;
    end if;
  end if;

  insert into public.marketplace_listings
    (seller_character_id, item_id, currency_type, price_currency, price_amount, fee_amount, status, expires_at)
  values
    (p_character_id, p_item_id, p_currency_type, p_price_currency, p_price_amount, v_fee, 'active', now() + (p_duration_hours || ' hours')::interval)
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

revoke all on function public.create_marketplace_listing(uuid, uuid, text, integer, integer, text) from public;
grant execute on function public.create_marketplace_listing(uuid, uuid, text, integer, integer, text) to authenticated;

-- The old 5-arg overload from the previous migration is superseded by the
-- 6-arg version above (CREATE OR REPLACE can't change a parameter list in
-- place when called positionally by the old client, but PostgREST/supabase-js
-- always calls by name, so the new optional 6th parameter is additive from
-- the caller's perspective) -- drop the stale overload so nothing can call
-- into a half-updated function by accident.
drop function if exists public.create_marketplace_listing(uuid, uuid, text, integer, integer);

-- ============================================================================
-- buy_marketplace_listing: branches on item vs currency for both the
-- ownership-transfer step (only applies to gear) and every Mail insert.
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
  v_seller_account_id uuid;
  v_item_id uuid;
  v_currency_type text;
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

  select seller_character_id, item_id, currency_type, status, expires_at, price_currency, price_amount
  into v_seller_character_id, v_item_id, v_currency_type, v_status, v_expires_at, v_price_currency, v_price_amount
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
    if v_item_id is not null then
      insert into public.mail (character_id, item_id, reason) values (v_seller_character_id, v_item_id, 'listing_expired');
    else
      insert into public.mail (character_id, currency_type, reason) values (v_seller_character_id, v_currency_type, 'listing_expired');
    end if;
    return jsonb_build_object('ok', false, 'error', 'listing_expired');
  end if;

  select account_id into v_seller_account_id from public.characters where id = v_seller_character_id;

  if v_price_currency = 'gold' then
    perform 1 from public.characters where id in (p_character_id, v_seller_character_id) order by id for update;
    select gold into v_buyer_balance from public.characters where id = p_character_id;
    if v_buyer_balance < v_price_amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gold');
    end if;
    update public.characters set gold = gold - v_price_amount where id = p_character_id returning gold into v_new_buyer_balance;
    update public.characters set gold = gold + v_price_amount where id = v_seller_character_id;
  else
    perform 1 from public.players where id in (v_buyer_account_id, v_seller_account_id) order by id for update;
    select ascension_points into v_buyer_balance from public.players where id = v_buyer_account_id;
    if v_buyer_balance < v_price_amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ascension_points');
    end if;
    update public.players set ascension_points = ascension_points - v_price_amount where id = v_buyer_account_id
    returning ascension_points into v_new_buyer_balance;
    update public.players set ascension_points = ascension_points + v_price_amount where id = v_seller_account_id;
  end if;

  if v_item_id is not null then
    update public.item_instances set owner_id = p_character_id where id = v_item_id;
  end if;

  update public.marketplace_listings
    set status = 'sold', buyer_character_id = p_character_id, sold_at = now()
    where id = p_listing_id;

  if v_item_id is not null then
    insert into public.mail (character_id, item_id, reason) values (p_character_id, v_item_id, 'purchase');
  else
    insert into public.mail (character_id, currency_type, reason) values (p_character_id, v_currency_type, 'purchase');
  end if;

  return jsonb_build_object(
    'ok', true,
    'gold', case when v_price_currency = 'gold' then v_new_buyer_balance else null end,
    'ascension_points', case when v_price_currency = 'ascension_points' then v_new_buyer_balance else null end
  );
end;
$$;

-- ============================================================================
-- end_marketplace_listing: same item-vs-currency branch for the returning
-- Mail insert.
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
  v_currency_type text;
  v_status text;
  v_expires_at timestamptz;
  v_new_status text;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select seller_character_id, item_id, currency_type, status, expires_at
  into v_seller_character_id, v_item_id, v_currency_type, v_status, v_expires_at
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

  if v_item_id is not null then
    insert into public.mail (character_id, item_id, reason)
    values (p_character_id, v_item_id, case when v_new_status = 'expired' then 'listing_expired' else 'listing_cancelled' end);
  else
    insert into public.mail (character_id, currency_type, reason)
    values (p_character_id, v_currency_type, case when v_new_status = 'expired' then 'listing_expired' else 'listing_cancelled' end);
  end if;

  return jsonb_build_object('ok', true, 'status', v_new_status);
end;
$$;

-- ============================================================================
-- claim_mail: a currency entry's actual increment happens here, at claim
-- time -- unlike a gear entry (whose owner_id was already set correctly at
-- purchase time, so claiming there just stops hiding it), same reasoning
-- claim_loot_holding's own currency branch already established.
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
  v_currency_type text;
  v_new_count integer;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id, currency_type into v_mail_character_id, v_item_id, v_currency_type
  from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  if v_currency_type is not null then
    if v_currency_type = 'meteor' then
      update public.characters set meteor_count = meteor_count + 1 where id = p_character_id returning meteor_count into v_new_count;
    elsif v_currency_type = 'dragonball' then
      update public.characters set dragonball_count = dragonball_count + 1 where id = p_character_id returning dragonball_count into v_new_count;
    elsif v_currency_type = 'meteor_scroll' then
      update public.characters set meteor_scroll_count = meteor_scroll_count + 1 where id = p_character_id
      returning meteor_scroll_count into v_new_count;
    else
      update public.characters set dragonball_scroll_count = dragonball_scroll_count + 1 where id = p_character_id
      returning dragonball_scroll_count into v_new_count;
    end if;

    delete from public.mail where id = p_mail_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  delete from public.mail where id = p_mail_id;

  return jsonb_build_object('ok', true, 'item_id', v_item_id);
end;
$$;

commit;
