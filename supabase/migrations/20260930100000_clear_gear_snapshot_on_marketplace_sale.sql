-- Fixes a gap the user asked to double-check: buy_marketplace_listing
-- reassigns item_instances.owner_id to the buyer, but never touched
-- character_gear_snapshots -- the seller's frozen claim (if any) on that
-- item_id kept existing after the sale. Since claim_gear_snapshot looks up
-- "does any OTHER character currently claim this item_id," the buyer would
-- have hit the already_claimed prompt referencing the SELLER (a stranger
-- they may have never interacted with) the moment they equipped their new
-- purchase -- confusing, and pointless since the seller no longer has any
-- stake in the item at all.
--
-- Fix, scoped deliberately to only this path: a completed sale now deletes
-- any character_gear_snapshots row on that item_id outright (no transfer,
-- no prompt for the buyer) -- selling is a final disposal, not a "you might
-- want it back" move. This is intentionally NOT applied to
-- withdraw_item_from_storage (moving gear to another of your OWN
-- characters via the account-wide Bank) -- that's the exact scenario the
-- claim-prompt mechanic exists to guard, so it keeps prompting on equip as
-- designed. Body otherwise an unchanged copy of the latest version
-- (20260907000000_mail_item_snapshot_and_resell_fix.sql).
create or replace function public.buy_marketplace_listing(p_character_id uuid, p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_account_id uuid;
  v_buyer_character_name text;
  v_seller_character_id uuid;
  v_seller_account_id uuid;
  v_item_id uuid;
  v_currency_type text;
  v_status text;
  v_expires_at timestamptz;
  v_price_currency text;
  v_price_amount integer;
  v_item_template_id uuid;
  v_item_quality_tier text;
  v_item_level integer;
  v_item_composition_level integer;
  v_buyer_balance integer;
  v_new_buyer_balance integer;
begin
  select account_id, name into v_buyer_account_id, v_buyer_character_name from public.characters where id = p_character_id;
  if v_buyer_account_id is null or v_buyer_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select seller_character_id, item_id, currency_type, status, expires_at, price_currency, price_amount,
         item_template_id, item_quality_tier, item_level, item_composition_level
  into v_seller_character_id, v_item_id, v_currency_type, v_status, v_expires_at, v_price_currency, v_price_amount,
       v_item_template_id, v_item_quality_tier, v_item_level, v_item_composition_level
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
      insert into public.mail (character_id, item_id, reason, item_template_id, item_quality_tier, item_level, item_composition_level)
      values (v_seller_character_id, v_item_id, 'listing_expired', v_item_template_id, v_item_quality_tier, v_item_level, v_item_composition_level);
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
    -- A sale is a final disposal -- the seller's Gear Score claim (if any)
    -- on this exact item is dropped outright, not transferred/prompted.
    delete from public.character_gear_snapshots where item_id = v_item_id;
  end if;

  update public.marketplace_listings
    set status = 'sold', buyer_character_id = p_character_id, sold_at = now()
    where id = p_listing_id;

  if v_item_id is not null then
    insert into public.mail (character_id, item_id, reason, item_template_id, item_quality_tier, item_level, item_composition_level)
    values (p_character_id, v_item_id, 'purchase', v_item_template_id, v_item_quality_tier, v_item_level, v_item_composition_level);
  else
    insert into public.mail (character_id, currency_type, reason) values (p_character_id, v_currency_type, 'purchase');
  end if;

  -- Seller notification -- message-only (no item_id/currency_type), so it
  -- claims via MailTab's "Mark as Read" path rather than granting anything
  -- (the sale proceeds were already credited directly above).
  insert into public.mail (character_id, reason, sender_label, subject, message)
  values (
    v_seller_character_id,
    'sale_notification',
    'Market',
    'Listing Sold',
    coalesce(v_buyer_character_name, 'A player') || ' purchased your listing for ' || v_price_amount || ' ' ||
      (case when v_price_currency = 'gold' then 'Gold' else 'Ascension Points' end) || '.'
  );

  return jsonb_build_object(
    'ok', true,
    'gold', case when v_price_currency = 'gold' then v_new_buyer_balance else null end,
    'ascension_points', case when v_price_currency = 'ascension_points' then v_new_buyer_balance else null end
  );
end;
$$;
