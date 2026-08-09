-- Two Marketplace changes requested by the user (2026-08-13):
--
-- 1. Show which character posted a listing. `characters` has no
--    cross-account SELECT policy (own-account-only, see
--    20260727070000_add_character_slots.sql) so a Browse-tab viewer can't
--    read another account's character name directly. Snapshotting the
--    seller's name onto the listing row at creation time is the same
--    pattern 20260811000000_marketplace_listing_item_snapshot.sql already
--    established for the item's own display fields, for the same reason: an
--    active listing can't be modified/renamed anyway, so "at listing time"
--    is accurate for the listing's whole lifetime. Not retroactive -- a
--    listing created before this migration has no snapshot (null), same
--    disclosed limitation as the item snapshot.
--
-- 2. Waive the listing fee entirely for cheap listings. The fee has always
--    been ceil(price * 0.05), which forces a minimum 1-unit fee even when
--    true 5% of the price is a small fraction -- e.g. a price-5 listing pays
--    a 1-unit fee, which is actually 20% of the price, not 5%. Now: if the
--    true (unrounded) 5% doesn't even reach 1 whole unit (price < 20), the
--    fee is 0 instead of rounding up to 1. Unchanged for price >= 20 (fee is
--    still ceil(price * 0.05) there, same as before).
begin;

alter table public.marketplace_listings
  add column if not exists seller_character_name text;

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

    if exists (select 1 from public.mail where item_id = p_item_id) then
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

  v_raw_fee := p_price_amount * 0.05;
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

commit;
