-- Ascension Points become account-wide (confirmed with the user, 2026-08-03,
-- corrects the earlier per-character design from 20260802040000_add_
-- ascension_points.sql/20260802050000_add_marketplace.sql, both already
-- live) -- a premium currency, pooled across all 5 characters on an
-- account rather than five separate character totals. Same earn source
-- (selling quality gear) and spend (Marketplace) as before, just one shared
-- balance now, matching the existing bank_gold/bank_meteors/bank_dragonballs
-- account-level pattern on `players` -- except, unlike those, there's no
-- separate per-character "wallet" for AP at all anymore (nothing to
-- deposit/withdraw between), so it's a plain `players.ascension_points`
-- column with no `bank_` prefix, matching `unlocked_classes`' own shape
-- (a pure account-level field, not a wallet/bank pair).
--
-- Since these two prior migrations are already applied live, this is a
-- corrective follow-up, not an in-place edit of either of them.
begin;

alter table public.players add column if not exists ascension_points integer not null default 0;

-- Backfill: sum whatever any character on each account had already earned
-- under the old per-character model, so nothing already-earned is lost by
-- this correction.
update public.players p
set ascension_points = coalesce((select sum(c.ascension_points) from public.characters c where c.account_id = p.id), 0);

alter table public.characters drop column if exists ascension_points;

-- ============================================================================
-- sell_item / sell_loot_holding: AP now credits the account's own players
-- row (looked up via the already-fetched account_id), not the selling
-- character's row.
-- ============================================================================
create or replace function public.sell_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_price integer;
  v_multiplier numeric;
  v_sell_price integer;
  v_ap_gained integer;
  v_new_gold integer;
  v_new_ap integer;
begin
  select owner_id, template_id, quality_tier into v_character_id, v_template_id, v_quality_tier
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

  select price into v_price from public.item_templates where id = v_template_id;

  v_multiplier := case v_quality_tier
    when 'normal' then 1
    when 'refined' then 1.25
    when 'unique' then 1.5
    when 'elite' then 1.75
    when 'super' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  v_ap_gained := case v_quality_tier
    when 'refined' then 1
    when 'unique' then 2
    when 'elite' then 3
    when 'super' then 4
    else 0
  end;

  delete from public.item_instances where id = item_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;

create or replace function public.sell_loot_holding(holding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_currency_type text;
  v_price integer;
  v_multiplier numeric;
  v_sell_price integer;
  v_ap_gained integer;
  v_new_gold integer;
  v_new_ap integer;
begin
  select character_id, template_id, quality_tier, currency_type
  into v_character_id, v_template_id, v_quality_tier, v_currency_type
  from public.loot_holding
  where id = holding_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_currency_type is not null then
    return jsonb_build_object('ok', false, 'error', 'not_sellable');
  end if;

  select price into v_price from public.item_templates where id = v_template_id;

  v_multiplier := case v_quality_tier
    when 'normal' then 1
    when 'refined' then 1.25
    when 'unique' then 1.5
    when 'elite' then 1.75
    when 'super' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  v_ap_gained := case v_quality_tier
    when 'refined' then 1
    when 'unique' then 2
    when 'elite' then 3
    when 'super' then 4
    else 0
  end;

  delete from public.loot_holding where id = holding_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;

revoke all on function public.sell_item(uuid) from public;
grant execute on function public.sell_item(uuid) to authenticated;
revoke all on function public.sell_loot_holding(uuid) from public;
grant execute on function public.sell_loot_holding(uuid) to authenticated;

-- ============================================================================
-- create_marketplace_listing: the AP fee branch now debits the seller's own
-- players row instead of their character row.
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
    select ascension_points into v_balance from public.players where id = v_account_id for update;
    if v_balance < v_fee then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ascension_points', 'fee', v_fee);
    end if;
    update public.players set ascension_points = ascension_points - v_fee where id = v_account_id
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
-- buy_marketplace_listing: an Ascension Points purchase now moves currency
-- between the buyer's and seller's own players rows (via each character's
-- account_id), not their characters rows -- locked in a fixed order (by id)
-- same deadlock-avoidance reasoning as the existing characters-row lock for
-- a Gold purchase. A same-account cross-character purchase (buyer and
-- seller sharing one account) locks/updates that single players row twice,
-- which nets to zero and is harmless -- Postgres's `where id in (x, x)`
-- simply matches the one row once.
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

commit;
