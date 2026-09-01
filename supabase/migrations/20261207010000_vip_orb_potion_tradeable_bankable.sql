-- VIP Token / Experience Orb / Experience Potion become Marketplace-listable
-- and Bank-able, same as Comet/Fallen Star already are (requested by the
-- user). Mail-crediting these three was already done in
-- 20261206000000_experience_orb_and_potion.sql (claim_mail already has
-- explicit branches for them, since Admin Mail could already grant them) --
-- buy_marketplace_listing/end_marketplace_listing/claim_mail need NO changes
-- here, they already branch generically on the currency_type text value.
--
-- Bank shape: a plain 1:1 balance transfer like Gold (no Scroll concept for
-- these three), but withdraw is room-gated like Comet/Fallen Star (each
-- withdrawn unit becomes its own Inventory tile) -- see transfer_currency's
-- new third branch below.
begin;

-- ============================================================================
-- 1. marketplace_listings_currency_type_check -- widen to the 3 new types.
--    mail_currency_type_check already allows them (20261206000000).
-- ============================================================================
alter table public.marketplace_listings drop constraint if exists marketplace_listings_currency_type_check;
alter table public.marketplace_listings add constraint marketplace_listings_currency_type_check
  check (currency_type in (
    'comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll',
    'vip_token', 'experience_orb', 'experience_potion'
  ));

-- ============================================================================
-- 2. create_marketplace_listing -- full-body copy of the latest version
--    (20260907000000_mail_item_snapshot_and_resell_fix.sql), widened to
--    accept the 3 new currency types.
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
  if p_currency_type is not null and p_currency_type not in (
    'comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll',
    'vip_token', 'experience_orb', 'experience_potion'
  ) then
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
    elsif p_currency_type = 'fallen_star_scroll' then
      select fallen_star_scroll_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'vip_token' then
      select vip_token_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'experience_orb' then
      select experience_orb_count into v_unit_count from public.characters where id = p_character_id for update;
    else
      select experience_potion_count into v_unit_count from public.characters where id = p_character_id for update;
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
    elsif p_currency_type = 'fallen_star_scroll' then
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count - 1 where id = p_character_id;
    elsif p_currency_type = 'vip_token' then
      update public.characters set vip_token_count = vip_token_count - 1 where id = p_character_id;
    elsif p_currency_type = 'experience_orb' then
      update public.characters set experience_orb_count = experience_orb_count - 1 where id = p_character_id;
    else
      update public.characters set experience_potion_count = experience_potion_count - 1 where id = p_character_id;
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
-- 3. players -- 3 new Bank balance columns, same shape as bank_comets/
--    bank_fallen_stars.
-- ============================================================================
alter table public.players add column if not exists bank_vip_tokens integer not null default 0;
alter table public.players add constraint players_bank_vip_tokens_check check (bank_vip_tokens >= 0);
alter table public.players add column if not exists bank_experience_orbs integer not null default 0;
alter table public.players add constraint players_bank_experience_orbs_check check (bank_experience_orbs >= 0);
alter table public.players add column if not exists bank_experience_potions integer not null default 0;
alter table public.players add constraint players_bank_experience_potions_check check (bank_experience_potions >= 0);

-- ============================================================================
-- 4. transfer_currency -- full-body copy of the latest version
--    (20261031000000_bank_and_promotion_pickaxe_room_check.sql), adding a
--    3rd behavior group: vip_tokens/experience_orbs/experience_potions,
--    deposit/withdraw 1:1 like gold (no Scroll concept), but withdraw is
--    room-gated like comets/fallen_stars (each unit becomes an Inventory
--    tile) -- the existing v_occupied calc now also counts these 3 towards
--    the 40-slot cap for this group's own withdraw check.
-- ============================================================================
create or replace function public.transfer_currency(
  character_id uuid,
  currency text,
  amount integer,
  direction text,
  force_individual boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_balance integer;
  v_bank_balance integer;
  v_scroll_count integer;
  v_scrolls_needed integer;
  v_equipped_ids uuid[];
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_vip_token_count integer;
  v_experience_orb_count integer;
  v_experience_potion_count integer;
  v_occupied integer;
  v_withdraw_scrolls integer;
  v_withdraw_remainder integer;
  v_tiles_needed integer;
  v_free_slots integer;
begin
  if currency not in ('gold', 'comets', 'fallen_stars', 'vip_tokens', 'experience_orbs', 'experience_potions') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id,
         comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         vip_token_count, experience_orb_count, experience_potion_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_vip_token_count, v_experience_orb_count, v_experience_potion_count, v_equipped_ids
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
  elsif currency = 'comets' then
    v_character_balance := v_comet_count;
    v_scroll_count := v_comet_scroll_count;
    select bank_comets into v_bank_balance from public.players where id = v_account_id;
  elsif currency = 'fallen_stars' then
    v_character_balance := v_fallen_star_count;
    v_scroll_count := v_fallen_star_scroll_count;
    select bank_fallen_stars into v_bank_balance from public.players where id = v_account_id;
  elsif currency = 'vip_tokens' then
    v_character_balance := v_vip_token_count;
    select bank_vip_tokens into v_bank_balance from public.players where id = v_account_id;
  elsif currency = 'experience_orbs' then
    v_character_balance := v_experience_orb_count;
    select bank_experience_orbs into v_bank_balance from public.players where id = v_account_id;
  else
    v_character_balance := v_experience_potion_count;
    select bank_experience_potions into v_bank_balance from public.players where id = v_account_id;
  end if;

  if direction = 'deposit' then
    if currency = 'gold' then
      if v_character_balance < amount then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;
      v_character_balance := v_character_balance - amount;
    elsif currency in ('comets', 'fallen_stars') then
      if amount > v_character_balance + v_scroll_count * 10 then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;

      v_scrolls_needed := greatest(0, ceil((amount - v_character_balance) / 10.0))::integer;
      v_scroll_count := v_scroll_count - v_scrolls_needed;
      v_character_balance := v_character_balance + v_scrolls_needed * 10 - amount;
    else
      if v_character_balance < amount then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;
      v_character_balance := v_character_balance - amount;
    end if;
    v_bank_balance := v_bank_balance + amount;
  else
    if v_bank_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;

    if currency in ('comets', 'fallen_stars') then
      select count(*) into v_gear_count
      from public.item_instances
      where owner_id = character_id
        and location <> 'bank'
        and not (id = any(v_equipped_ids))
        and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
        and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

      select coalesce(sum((value)::integer), 0) into v_stone_count
      from public.characters, jsonb_each_text(composition_stones)
      where id = character_id;

      select count(*) into v_potion_count
      from public.potion_stacks ps
      where ps.character_id = transfer_currency.character_id and ps.count > 0;

      v_occupied := v_gear_count + v_stone_count + v_potion_count
        + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count
        + v_vip_token_count + v_experience_orb_count + v_experience_potion_count;

      if force_individual then
        v_withdraw_scrolls := 0;
        v_withdraw_remainder := amount;
        v_tiles_needed := amount;
      else
        v_withdraw_scrolls := amount / 10;
        v_withdraw_remainder := amount % 10;
        v_tiles_needed := v_withdraw_scrolls + v_withdraw_remainder;
      end if;

      v_free_slots := greatest(0, 40 - v_occupied);

      if v_tiles_needed > v_free_slots then
        return jsonb_build_object(
          'ok', false, 'error', 'not_enough_room',
          'occupied', v_occupied,
          'max_withdrawable', v_free_slots * (case when force_individual then 1 else 10 end)
        );
      end if;

      v_scroll_count := v_scroll_count + v_withdraw_scrolls;
      v_character_balance := v_character_balance + v_withdraw_remainder;
    elsif currency in ('vip_tokens', 'experience_orbs', 'experience_potions') then
      select count(*) into v_gear_count
      from public.item_instances
      where owner_id = character_id
        and location <> 'bank'
        and not (id = any(v_equipped_ids))
        and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
        and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

      select coalesce(sum((value)::integer), 0) into v_stone_count
      from public.characters, jsonb_each_text(composition_stones)
      where id = character_id;

      select count(*) into v_potion_count
      from public.potion_stacks ps
      where ps.character_id = transfer_currency.character_id and ps.count > 0;

      v_occupied := v_gear_count + v_stone_count + v_potion_count
        + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count
        + v_vip_token_count + v_experience_orb_count + v_experience_potion_count;

      v_free_slots := greatest(0, 40 - v_occupied);

      if amount > v_free_slots then
        return jsonb_build_object(
          'ok', false, 'error', 'not_enough_room',
          'occupied', v_occupied,
          'max_withdrawable', v_free_slots
        );
      end if;

      v_character_balance := v_character_balance + amount;
    else
      v_character_balance := v_character_balance + amount;
    end if;

    v_bank_balance := v_bank_balance - amount;
  end if;

  if currency = 'gold' then
    update public.characters set gold = v_character_balance where id = character_id;
    update public.players set bank_gold = v_bank_balance where id = v_account_id;
  elsif currency = 'comets' then
    update public.characters
    set comet_count = v_character_balance, comet_scroll_count = v_scroll_count
    where id = character_id;
    update public.players set bank_comets = v_bank_balance where id = v_account_id;
  elsif currency = 'fallen_stars' then
    update public.characters
    set fallen_star_count = v_character_balance, fallen_star_scroll_count = v_scroll_count
    where id = character_id;
    update public.players set bank_fallen_stars = v_bank_balance where id = v_account_id;
  elsif currency = 'vip_tokens' then
    update public.characters set vip_token_count = v_character_balance where id = character_id;
    update public.players set bank_vip_tokens = v_bank_balance where id = v_account_id;
  elsif currency = 'experience_orbs' then
    update public.characters set experience_orb_count = v_character_balance where id = character_id;
    update public.players set bank_experience_orbs = v_bank_balance where id = v_account_id;
  else
    update public.characters set experience_potion_count = v_character_balance where id = character_id;
    update public.players set bank_experience_potions = v_bank_balance where id = v_account_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'character_balance', v_character_balance,
    'bank_balance', v_bank_balance,
    'character_scroll_count', v_scroll_count
  );
end;
$$;

commit;
