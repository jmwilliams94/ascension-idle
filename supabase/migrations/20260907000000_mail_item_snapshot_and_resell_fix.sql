-- Fixes two Marketplace/Mail bugs (reported by the user):
--
-- 1. Resell-after-claim bug -- create_marketplace_listing's item_in_mail
--    check (`exists (select 1 from mail where item_id = p_item_id)`) never
--    filtered on claimed_at, so once an item passed through Mail even once
--    (a purchase, or a cancelled/expired listing returning it to the
--    seller) it stayed permanently unlistable -- the still-there *claimed*
--    history row kept matching forever, since claim_mail marks claimed_at
--    instead of deleting the row (20260813110000_mail_history.sql). Fixed
--    to `and claimed_at is null`, the same "only a still-unclaimed mail row
--    counts" filter every server-side room-check query already uses
--    (20260901060000_room_check_excludes_listed_and_mailed.sql).
--
-- 2. Mail tooltip/appearance drift -- a Mail row's tile rendered the *live*
--    item_instances join, so a purchased/returned item's mail history entry
--    kept changing appearance as the player later Forged/leveled/
--    requalitied it after claiming, instead of showing what it looked like
--    when it arrived. Mirrors marketplace_listings' own item_* snapshot
--    columns (20260811000000_marketplace_listing_item_snapshot.sql) -- mail
--    gains the same 4 columns, populated at insert time by every RPC that
--    mails a gear item (buy_marketplace_listing, end_marketplace_listing,
--    admin_send_mail). buy_marketplace_listing/end_marketplace_listing pull
--    the values straight off the listing row's own snapshot rather than
--    re-reading item_instances -- an actively-listed item can't be modified
--    (excluded from every Inventory/Forge grid while status = 'active'), so
--    the listing's snapshot is still accurate at buy/cancel/expiry time.
--    Frontend (MarketplacePanel.tsx) prefers this new snapshot over the live
--    join; unlike a sold listing, a mailed item's live join stays
--    RLS-readable forever (still owned by the recipient), so a pre-migration
--    row with a null snapshot just falls back to the live item -- no "Item
--    unavailable" case needed here.
begin;

alter table public.mail add column if not exists item_template_id uuid references public.item_templates(id);
alter table public.mail add column if not exists item_quality_tier text;
alter table public.mail add column if not exists item_level integer;
alter table public.mail add column if not exists item_composition_level integer;

-- ============================================================================
-- 1. create_marketplace_listing -- item_in_mail now only blocks on a still-
--    unclaimed mail row.
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
  v_character_name text;
  v_owner_id uuid;
  v_item_template_id uuid;
  v_item_quality_tier text;
  v_item_level integer;
  v_item_composition_level integer;
  v_fee_rate numeric;
  v_raw_fee numeric;
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
  if p_currency_type is not null and p_currency_type not in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll') then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;

  select account_id, name into v_account_id, v_character_name from public.characters where id = p_character_id for update;
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
    select owner_id, template_id, quality_tier, level, composition_level
    into v_owner_id, v_item_template_id, v_item_quality_tier, v_item_level, v_item_composition_level
    from public.item_instances where id = p_item_id for update;
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

    if exists (select 1 from public.mail where item_id = p_item_id and claimed_at is null) then
      return jsonb_build_object('ok', false, 'error', 'item_in_mail');
    end if;
  else
    if p_currency_type = 'comet' then
      select comet_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'fallen_star' then
      select fallen_star_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'comet_scroll' then
      select comet_scroll_count into v_unit_count from public.characters where id = p_character_id for update;
    else
      select fallen_star_scroll_count into v_unit_count from public.characters where id = p_character_id for update;
    end if;
    if coalesce(v_unit_count, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_currency');
    end if;
  end if;

  v_fee_rate := case when p_price_currency = 'ascension_points' then 0.01 else 0.05 end;
  v_raw_fee := p_price_amount * v_fee_rate;
  v_fee := case when v_raw_fee < 1 then 0 else ceil(v_raw_fee) end;

  if v_fee > 0 then
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
  end if;

  -- Every guard has passed -- mutate now.
  if v_fee > 0 then
    if p_price_currency = 'gold' then
      update public.characters set gold = gold - v_fee where id = p_character_id returning gold into v_new_balance;
    else
      update public.players set ascension_points = ascension_points - v_fee where id = v_account_id
      returning ascension_points into v_new_balance;
    end if;
  else
    if p_price_currency = 'gold' then
      select gold into v_new_balance from public.characters where id = p_character_id;
    else
      select ascension_points into v_new_balance from public.players where id = v_account_id;
    end if;
  end if;

  if p_currency_type is not null then
    if p_currency_type = 'comet' then
      update public.characters set comet_count = comet_count - 1 where id = p_character_id;
    elsif p_currency_type = 'fallen_star' then
      update public.characters set fallen_star_count = fallen_star_count - 1 where id = p_character_id;
    elsif p_currency_type = 'comet_scroll' then
      update public.characters set comet_scroll_count = comet_scroll_count - 1 where id = p_character_id;
    else
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count - 1 where id = p_character_id;
    end if;
  end if;

  insert into public.marketplace_listings
    (seller_character_id, seller_character_name, item_id, currency_type, price_currency, price_amount, fee_amount, status, expires_at,
     item_template_id, item_quality_tier, item_level, item_composition_level)
  values
    (p_character_id, v_character_name, p_item_id, p_currency_type, p_price_currency, p_price_amount, v_fee, 'active', now() + (p_duration_hours || ' hours')::interval,
     v_item_template_id, v_item_quality_tier, v_item_level, v_item_composition_level)
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

-- ============================================================================
-- 2. buy_marketplace_listing -- snapshots the listing's own item_* columns
--    (already captured at listing time) onto both item-carrying mail
--    inserts: the buyer's purchase, and the seller's return-on-buy-time-
--    expiry.
-- ============================================================================
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

-- ============================================================================
-- 3. end_marketplace_listing -- same snapshot pass-through for the returning
--    cancelled/expired mail insert.
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
  v_item_template_id uuid;
  v_item_quality_tier text;
  v_item_level integer;
  v_item_composition_level integer;
  v_new_status text;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select seller_character_id, item_id, currency_type, status, expires_at,
         item_template_id, item_quality_tier, item_level, item_composition_level
  into v_seller_character_id, v_item_id, v_currency_type, v_status, v_expires_at,
       v_item_template_id, v_item_quality_tier, v_item_level, v_item_composition_level
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
    insert into public.mail (character_id, item_id, reason, item_template_id, item_quality_tier, item_level, item_composition_level)
    values (
      p_character_id, v_item_id, case when v_new_status = 'expired' then 'listing_expired' else 'listing_cancelled' end,
      v_item_template_id, v_item_quality_tier, v_item_level, v_item_composition_level
    );
  else
    insert into public.mail (character_id, currency_type, reason)
    values (p_character_id, v_currency_type, case when v_new_status = 'expired' then 'listing_expired' else 'listing_cancelled' end);
  end if;

  return jsonb_build_object('ok', true, 'status', v_new_status);
end;
$$;

-- ============================================================================
-- 4. admin_send_mail -- snapshots the just-created item's own known
--    template/quality/level/composition (no re-read needed, they're already
--    local variables at the point the item_instances row is inserted).
-- ============================================================================
create or replace function public.admin_send_mail(p_target text, p_subject text, p_message text, p_rewards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_account_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_character record;
  v_recipient_count integer := 0;
  v_reward jsonb;
  v_reward_count integer;
  v_template_id uuid;
  v_required_level integer;
  v_slot_type text;
  v_quality_tier text;
  v_composition_level integer;
  v_new_item item_instances%rowtype;
begin
  select id into v_admin_account_id from auth.users where email = 'jmwilliams94@icloud.com';
  if v_admin_account_id is null or auth.uid() <> v_admin_account_id then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_subject is null or length(trim(p_subject)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'subject_required');
  end if;

  if p_message is null or length(trim(p_message)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'message_required');
  end if;

  v_reward_count := jsonb_array_length(coalesce(p_rewards, '[]'::jsonb));

  for v_character in
    select id from public.characters
    where p_target = 'all' or name = trim(p_target)
  loop
    v_recipient_count := v_recipient_count + 1;

    if v_reward_count = 0 then
      insert into public.mail (character_id, reason, mail_batch_id, sender_label, subject, message)
      values (v_character.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message);
    else
      for v_reward in select * from jsonb_array_elements(p_rewards)
      loop
        if v_reward ->> 'type' = 'item' then
          select id, required_level, slot_type into v_template_id, v_required_level, v_slot_type
          from public.item_templates where id = (v_reward ->> 'template_id')::uuid;

          if v_template_id is not null then
            v_quality_tier := coalesce(v_reward ->> 'quality_tier', 'normal');
            v_composition_level := coalesce((v_reward ->> 'composition_level')::integer, 0);

            insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level, sockets, durability)
            values (
              v_template_id,
              v_character.id,
              v_quality_tier,
              v_required_level,
              v_composition_level,
              '[]'::jsonb,
              coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
            )
            returning * into v_new_item;

            insert into public.mail
              (character_id, item_id, reason, mail_batch_id, sender_label, subject, message,
               item_template_id, item_quality_tier, item_level, item_composition_level)
            values
              (v_character.id, v_new_item.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message,
               v_template_id, v_quality_tier, v_required_level, v_composition_level);
          end if;
        elsif v_reward ->> 'type' = 'currency' then
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (
            v_character.id,
            v_reward ->> 'currency_type',
            greatest(1, coalesce((v_reward ->> 'amount')::integer, 1)),
            'admin_gift',
            v_batch_id,
            'GM Switchee',
            p_subject,
            p_message
          );
        end if;
      end loop;
    end if;
  end loop;

  if v_recipient_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;

  return jsonb_build_object('ok', true, 'batch_id', v_batch_id, 'recipient_count', v_recipient_count);
end;
$$;

commit;
