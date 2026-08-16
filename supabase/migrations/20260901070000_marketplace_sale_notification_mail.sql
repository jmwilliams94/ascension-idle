-- Marketplace sale notification (requested by the user): a seller currently
-- gets Gold/AP credited silently when their listing sells -- no Mail entry
-- at all, so there's no record of who bought it. buy_marketplace_listing
-- already mails the *buyer* the purchased item; this adds a second,
-- message-only mail row (no item_id/currency_type -- mail_target_check
-- already allows "neither" since 20260813120000_mail_optional_rewards.sql)
-- to the *seller* naming the buyer's character and the sale price. Renders
-- via MailTab's existing "Mark as Read" path for reward-less rows, same as
-- an Admin Mail message-only send.
--
-- Full body is a copy of buy_marketplace_listing's current latest definition
-- (20260803010000_marketplace_currency_listings.sql) with one addition: a
-- second mail insert for the seller right after the existing buyer insert.
-- Same 2-arg signature -- create or replace is safe.
begin;

alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in (
    'purchase', 'listing_cancelled', 'listing_expired', 'admin_gift', 'bug_report_reward',
    'suggestion_reward', 'world_boss_reward', 'gold_donation_reward', 'sale_notification'
  ));

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
  v_buyer_balance integer;
  v_new_buyer_balance integer;
begin
  select account_id, name into v_buyer_account_id, v_buyer_character_name from public.characters where id = p_character_id;
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

revoke all on function public.buy_marketplace_listing(uuid, uuid) from public;
grant execute on function public.buy_marketplace_listing(uuid, uuid) to authenticated;

commit;
