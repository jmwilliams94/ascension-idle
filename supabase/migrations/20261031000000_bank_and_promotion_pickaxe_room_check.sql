-- Same root cause as 20261029000000/20261030000000: the 20261024000000
-- pickaxe-dedicated-equip-slot migration only swept occupied_inventory_slots
-- and resolve_mining_gather_state's own equipped-ids exclusion arrays,
-- explicitly disclosing every other room-check-shaped function as
-- "pre-existing duplication, not swept here". Five more surfaced from a
-- full audit of every function that computes a real v_occupied/gear_count
-- against the 40-slot cap (reported by the user: withdrawing 20 Comets from
-- Bank on character "Switchee", who has a Pickaxe equipped, was refused
-- with "only 19 will fit" even though the client showed 20 free slots) --
-- Bank's per-currency withdraw (`transfer_currency`, Comets/Fallen Stars)
-- and Gem withdraw (`transfer_gem`), Scroll-unbundling
-- (`unbundle_currency_scroll`/`ensure_loose_currency`), and Class Promotion
-- (`promote_character`, both its cost-affordability count and its
-- award-item room check). Every one of these still ran its own stale
-- 7-pointer equipped-ids array with no `equipped_pickaxe_id`, so a character
-- with a Pickaxe equipped had it silently counted as a real, unequipped
-- Inventory item by all five.
--
-- Full bodies copied verbatim from each function's current latest
-- definition (verified via `create or replace function` grep across every
-- migration; all five happen to share the same latest source file,
-- 20260901060000_room_check_excludes_listed_and_mailed.sql) with only the
-- equipped-ids array widened. No signature changes, so plain
-- create-or-replace is safe throughout.
begin;

-- ============================================================================
-- 1. unbundle_currency_scroll
-- ============================================================================
create or replace function public.unbundle_currency_scroll(character_id uuid, currency_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_scroll_count integer;
  v_unit_count integer;
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_equipped_ids uuid[];
  v_occupied integer;
begin
  if currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select account_id,
         comet_count, fallen_star_count,
         comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_equipped_ids
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_scroll_count := case when currency_type = 'comet' then v_comet_scroll_count else v_fallen_star_scroll_count end;

  if v_scroll_count < 1 then
    return jsonb_build_object('ok', false, 'error', 'no_scrolls');
  end if;

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
  where ps.character_id = unbundle_currency_scroll.character_id and ps.count > 0;

  v_occupied := v_gear_count + v_stone_count + v_potion_count
    + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

  if v_occupied + 10 > 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room', 'occupied', v_occupied);
  end if;

  if currency_type = 'comet' then
    update public.characters
    set comet_count = comet_count + 10, comet_scroll_count = comet_scroll_count - 1
    where id = character_id
    returning comet_count, comet_scroll_count into v_unit_count, v_scroll_count;
  else
    update public.characters
    set fallen_star_count = fallen_star_count + 10, fallen_star_scroll_count = fallen_star_scroll_count - 1
    where id = character_id
    returning fallen_star_count, fallen_star_scroll_count into v_unit_count, v_scroll_count;
  end if;

  return jsonb_build_object('ok', true, 'currency_type', currency_type, 'unit_count', v_unit_count, 'scroll_count', v_scroll_count);
end;
$$;

-- ============================================================================
-- 2. ensure_loose_currency
-- ============================================================================
create or replace function public.ensure_loose_currency(
  p_character_id uuid,
  p_currency_type text,
  p_amount_needed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loose integer;
  v_scrolls integer;
  v_scrolls_needed integer;
  v_equipped_ids uuid[];
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_occupied integer;
begin
  if p_currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_loose := case when p_currency_type = 'comet' then v_comet_count else v_fallen_star_count end;
  v_scrolls := case when p_currency_type = 'comet' then v_comet_scroll_count else v_fallen_star_scroll_count end;

  if v_loose >= p_amount_needed then
    return jsonb_build_object('ok', true, 'unbundled', 0);
  end if;

  v_scrolls_needed := ceil((p_amount_needed - v_loose) / 10.0)::integer;

  if v_scrolls < v_scrolls_needed then
    return jsonb_build_object('ok', true, 'unbundled', 0);
  end if;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from public.characters, jsonb_each_text(composition_stones)
  where id = p_character_id;

  select count(*) into v_potion_count
  from public.potion_stacks ps
  where ps.character_id = p_character_id and ps.count > 0;

  v_occupied := v_gear_count + v_stone_count + v_potion_count
    + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

  if v_occupied + (9 * v_scrolls_needed - p_amount_needed) > 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room', 'occupied', v_occupied);
  end if;

  if p_currency_type = 'comet' then
    update public.characters
    set comet_count = comet_count + v_scrolls_needed * 10,
        comet_scroll_count = comet_scroll_count - v_scrolls_needed
    where id = p_character_id;
  else
    update public.characters
    set fallen_star_count = fallen_star_count + v_scrolls_needed * 10,
        fallen_star_scroll_count = fallen_star_scroll_count - v_scrolls_needed
    where id = p_character_id;
  end if;

  return jsonb_build_object('ok', true, 'unbundled', v_scrolls_needed);
end;
$$;

-- ============================================================================
-- 3. transfer_currency (Bank withdraw/deposit for Comets/Fallen Stars/Gold)
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
  v_occupied integer;
  v_withdraw_scrolls integer;
  v_withdraw_remainder integer;
  v_tiles_needed integer;
  v_free_slots integer;
begin
  if currency not in ('gold', 'comets', 'fallen_stars') then
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
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_equipped_ids
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
  else
    v_character_balance := v_fallen_star_count;
    v_scroll_count := v_fallen_star_scroll_count;
    select bank_fallen_stars into v_bank_balance from public.players where id = v_account_id;
  end if;

  if direction = 'deposit' then
    if currency = 'gold' then
      if v_character_balance < amount then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;
      v_character_balance := v_character_balance - amount;
    else
      if amount > v_character_balance + v_scroll_count * 10 then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;

      v_scrolls_needed := greatest(0, ceil((amount - v_character_balance) / 10.0))::integer;
      v_scroll_count := v_scroll_count - v_scrolls_needed;
      v_character_balance := v_character_balance + v_scrolls_needed * 10 - amount;
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
        + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

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
  else
    update public.characters
    set fallen_star_count = v_character_balance, fallen_star_scroll_count = v_scroll_count
    where id = character_id;
    update public.players set bank_fallen_stars = v_bank_balance where id = v_account_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'character_balance', v_character_balance,
    'bank_balance', v_bank_balance,
    'character_scroll_count', v_scroll_count
  );
end;
$$;

-- ============================================================================
-- 4. transfer_gem (Bank withdraw/deposit for Gems)
-- ============================================================================
create or replace function public.transfer_gem(character_id uuid, gem_id text, tier text, amount integer, direction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_key text;
  v_gems jsonb;
  v_gems_banked jsonb;
  v_character_balance integer;
  v_bank_balance integer;
  v_equipped_ids uuid[];
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_occupied integer;
begin
  if gem_id not in ('drake', 'ember', 'bastion', 'iris') then
    return jsonb_build_object('ok', false, 'error', 'invalid_gem');
  end if;

  if tier not in ('normal', 'tempered', 'ascended') then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;

  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_key := gem_id || '_' || tier;

  select account_id, gems, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_gems, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_equipped_ids
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select gems_banked into v_gems_banked from public.players where id = v_account_id for update;

  v_character_balance := coalesce((v_gems ->> v_key)::integer, 0);
  v_bank_balance := coalesce((v_gems_banked ->> v_key)::integer, 0);

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

    select coalesce(sum((value)::integer), 0) into v_gem_count
    from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = transfer_gem.character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

    if v_occupied + amount > 40 then
      return jsonb_build_object(
        'ok', false, 'error', 'not_enough_room',
        'occupied', v_occupied,
        'max_withdrawable', greatest(0, 40 - v_occupied)
      );
    end if;

    v_bank_balance := v_bank_balance - amount;
    v_character_balance := v_character_balance + amount;
  end if;

  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_key], to_jsonb(v_character_balance));
  v_gems_banked := jsonb_set(coalesce(v_gems_banked, '{}'::jsonb), array[v_key], to_jsonb(v_bank_balance));

  update public.characters set gems = v_gems where id = character_id;
  update public.players set gems_banked = v_gems_banked where id = v_account_id;

  return jsonb_build_object('ok', true, 'gems', v_gems, 'gems_banked', v_gems_banked);
end;
$$;

-- ============================================================================
-- 5. promote_character
-- ============================================================================
create or replace function public.promote_character(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_class text;
  v_char_level integer;
  v_promotion_level integer;
  v_gold integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_gems jsonb;
  v_equipped_ids uuid[];
  v_tier record;
  v_item jsonb;
  v_kind text;
  v_name text;
  v_qty integer;
  v_template_id uuid;
  v_owned_count integer;
  v_ensure_result jsonb;
  v_occupied integer;
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_freed_by_cost integer;
  v_award_room_needed integer;
  v_new_item public.item_instances%rowtype;
  v_granted_items jsonb := '[]'::jsonb;
  v_consumed jsonb := '[]'::jsonb;
  v_required_level integer;
  v_slot_type text;
  v_max_durability numeric;
  v_ids uuid[];
  v_gem_owned integer;
  i integer;
begin
  select account_id, class, level, promotion_level, gold, comet_count, fallen_star_count, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_class, v_char_level, v_promotion_level, v_gold, v_comet_count, v_fallen_star_count, v_gems,
       v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select * into v_tier
  from public.promotion_tiers
  where class = v_class and level > v_promotion_level
  order by level asc
  limit 1;

  if v_tier is null then
    return jsonb_build_object('ok', false, 'error', 'no_further_promotion');
  end if;

  if v_char_level < v_tier.level then
    return jsonb_build_object('ok', false, 'error', 'level_too_low', 'required_level', v_tier.level);
  end if;

  -- Pass 1: affordability only, no mutation yet.
  for v_item in select * from jsonb_array_elements(v_tier.items_required)
  loop
    v_kind := v_item ->> 'kind';
    v_name := v_item ->> 'name';
    v_qty := (v_item ->> 'quantity')::integer;

    if v_kind = 'currency' then
      if v_name = 'gold' then
        if v_gold < v_qty then
          return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_gold);
        end if;
      elsif v_name in ('comet', 'fallen_star') then
        v_ensure_result := public.ensure_loose_currency(p_character_id, v_name, v_qty);
        if not (v_ensure_result ->> 'ok')::boolean then
          return jsonb_build_object('ok', false, 'error', 'not_enough_room_to_unbundle');
        end if;

        if v_name = 'comet' then
          select comet_count into v_comet_count from public.characters where id = p_character_id;
          if v_comet_count < v_qty then
            return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_comet_count);
          end if;
        else
          select fallen_star_count into v_fallen_star_count from public.characters where id = p_character_id;
          if v_fallen_star_count < v_qty then
            return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_fallen_star_count);
          end if;
        end if;
      end if;
    elsif v_kind = 'item' then
      select id into v_template_id from public.item_templates where name = v_name;
      if v_template_id is null then
        return jsonb_build_object('ok', false, 'error', 'template_missing', 'missing', v_name);
      end if;

      select count(*) into v_owned_count
      from public.item_instances
      where owner_id = p_character_id
        and template_id = v_template_id
        and location <> 'bank'
        and not (id = any(v_equipped_ids))
        and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
        and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

      if v_owned_count < v_qty then
        return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_owned_count);
      end if;
    end if;
  end loop;

  -- Room check for item-kind award_items, net of the slots this same
  -- attempt's own item-kind cost consumption will free up.
  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from public.characters, jsonb_each_text(composition_stones)
  where id = p_character_id;

  select count(*) into v_potion_count
  from public.potion_stacks ps
  where ps.character_id = p_character_id and ps.count > 0;

  v_occupied := v_gear_count + v_stone_count + v_potion_count + v_comet_count + v_fallen_star_count;

  select coalesce(sum((value ->> 'quantity')::integer), 0) into v_freed_by_cost
  from jsonb_array_elements(v_tier.items_required)
  where value ->> 'kind' = 'item';

  select coalesce(sum((value ->> 'quantity')::integer), 0) into v_award_room_needed
  from jsonb_array_elements(v_tier.award_items)
  where value ->> 'kind' = 'item';

  if (v_occupied - v_freed_by_cost + v_award_room_needed) > 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room');
  end if;

  -- Pass 2: consume items_required.
  for v_item in select * from jsonb_array_elements(v_tier.items_required)
  loop
    v_kind := v_item ->> 'kind';
    v_name := v_item ->> 'name';
    v_qty := (v_item ->> 'quantity')::integer;

    if v_kind = 'currency' then
      if v_name = 'gold' then
        update public.characters set gold = gold - v_qty where id = p_character_id returning gold into v_gold;
      elsif v_name = 'comet' then
        update public.characters set comet_count = comet_count - v_qty where id = p_character_id returning comet_count into v_comet_count;
      elsif v_name = 'fallen_star' then
        update public.characters set fallen_star_count = fallen_star_count - v_qty where id = p_character_id returning fallen_star_count into v_fallen_star_count;
      end if;
      v_consumed := v_consumed || jsonb_build_array(jsonb_build_object('kind', 'currency', 'name', v_name, 'quantity', v_qty));
    elsif v_kind = 'item' then
      select id into v_template_id from public.item_templates where name = v_name;

      select array_agg(id) into v_ids from (
        select id from public.item_instances
        where owner_id = p_character_id and template_id = v_template_id
          and location <> 'bank' and not (id = any(v_equipped_ids))
          and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
          and id not in (select item_id from public.mail where item_id is not null and claimed_at is null)
        order by created_at asc
        limit v_qty
      ) as t;

      delete from public.item_instances where id = any(v_ids);
      v_consumed := v_consumed || jsonb_build_array(jsonb_build_object('kind', 'item', 'name', v_name, 'quantity', v_qty, 'item_ids', to_jsonb(v_ids)));
    end if;
  end loop;

  -- Grant award_items.
  for v_item in select * from jsonb_array_elements(v_tier.award_items)
  loop
    v_kind := v_item ->> 'kind';
    v_name := v_item ->> 'name';
    v_qty := (v_item ->> 'quantity')::integer;

    if v_kind = 'currency' then
      if v_name = 'gold' then
        update public.characters set gold = gold + v_qty where id = p_character_id returning gold into v_gold;
      elsif v_name = 'comet' then
        update public.characters set comet_count = comet_count + v_qty where id = p_character_id returning comet_count into v_comet_count;
      elsif v_name = 'fallen_star' then
        update public.characters set fallen_star_count = fallen_star_count + v_qty where id = p_character_id returning fallen_star_count into v_fallen_star_count;
      end if;
    elsif v_kind = 'gem' then
      v_gem_owned := coalesce((v_gems ->> v_name)::integer, 0);
      v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_name], to_jsonb(v_gem_owned + v_qty));
      update public.characters set gems = v_gems where id = p_character_id;
    elsif v_kind = 'item' then
      select id, required_level, slot_type into v_template_id, v_required_level, v_slot_type
      from public.item_templates where name = v_name;

      v_max_durability := coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0);

      for i in 1..v_qty loop
        insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
        values (v_template_id, p_character_id, 'normal', v_required_level, '[]'::jsonb, v_max_durability)
        returning * into v_new_item;
        v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
      end loop;
    end if;
  end loop;

  update public.characters set promotion_level = v_tier.level where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'title', v_tier.title,
    'promotion_level', v_tier.level,
    'skills_unlocked', v_tier.skills_unlocked,
    'consumed', v_consumed,
    'granted_items', v_granted_items,
    'gold', v_gold,
    'comet_count', v_comet_count,
    'fallen_star_count', v_fallen_star_count,
    'gems', v_gems
  );
end;
$$;

revoke all on function public.promote_character(uuid) from public;
grant execute on function public.promote_character(uuid) to authenticated;

commit;
