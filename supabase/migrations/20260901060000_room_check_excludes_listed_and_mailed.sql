-- Fixes a real bug reported by the user: "Market listed items seem to be
-- taking up an inventory slot." Every server-side room-check formula in this
-- file computes v_gear_count as a plain count of the character's own
-- item_instances rows (excluding only Bank Storage and equipped gear) --
-- unlike the client's own useInventoryStore.occupiedSlotCount, which was
-- fixed on 2026-08-13 to additionally exclude an actively-listed Marketplace
-- item and an item sitting in unclaimed Mail (both are real item_instances
-- rows still owned by the character, per the escrow model documented in
-- CLAUDE.marketplace-and-mail.md, but are hidden from the Inventory grid).
-- The client fix only ever touched the client's own display formula --
-- every server-side RPC that grants a new item/currency/stone/gem/potion
-- still counted a listed or unclaimed-mailed item as occupying a real slot,
-- so a player could see (say) "35/40" yet still have a grant rejected with
-- "not enough room," exactly matching the report.
--
-- Fixed by appending the same two exclusions to every v_gear_count query
-- below, mirroring the client's formula exactly:
--   and id not in (select item_id from marketplace_listings where status = 'active' and item_id is not null)
--   and id not in (select item_id from mail where item_id is not null and claimed_at is null)
--
-- Every function below is a full-body copy of its current latest definition
-- (verified via `create or replace function` grep across every migration) --
-- only the v_gear_count/v_owned_count queries changed, nothing else. No
-- signature changes anywhere, so plain create-or-replace is safe throughout
-- (no overload risk).
begin;

-- ============================================================================
-- 1. occupied_inventory_slots -- shared helper (shop_buy_item/shop_buy_potion)
--    Full body from 20260821000000_lock_down_direct_table_writes.sql.
-- ============================================================================
create or replace function public.occupied_inventory_slots(p_character_id uuid)
returns integer
language plpgsql
as $$
declare
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_equipped_ids uuid[];
begin
  select composition_stones, gems, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_composition_stones, v_gems, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_equipped_ids
  from public.characters
  where id = p_character_id;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

  select coalesce(sum((value)::integer), 0) into v_gem_count
  from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

  select count(*) into v_potion_count
  from public.potion_stacks where character_id = p_character_id and count > 0;

  return v_gear_count + v_stone_count + v_gem_count + v_potion_count
    + coalesce(v_comet_count, 0) + coalesce(v_fallen_star_count, 0)
    + coalesce(v_comet_scroll_count, 0) + coalesce(v_fallen_star_scroll_count, 0);
end;
$$;

-- ============================================================================
-- 2. unbundle_currency_scroll -- full body from
--    20260805020000_fix_unbundle_room_check_equipped_banked.sql.
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
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
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
-- 3. ensure_loose_currency -- full body from
--    20260808030000_fix_ensure_loose_currency_room_check.sql.
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
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
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
-- 4. transfer_currency -- full body from
--    20260814020000_bank_currency_individual_withdraw.sql.
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
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
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
-- 5. transfer_gem -- full body from 20260809010000_gem_inventory_and_bank.sql.
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
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
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
-- 6. resolve_combat_gather_state -- full body from
--    20260829000000_resolve_combat_active_gold_donation_event.sql.
-- ============================================================================
create or replace function public.resolve_combat_gather_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_old_character jsonb;
  v_old_resolved_at timestamptz;
  v_selected_monster_id text;
  v_account_id uuid;
  v_rows_updated integer;
  v_claimed boolean;
  v_monster jsonb;
  v_equipped_items jsonb;
  v_equipped_ids_no_quiver uuid[];
  v_equipped_ids_with_quiver uuid[];
  v_gear_count integer;
  v_potion_count integer;
  v_holding_count integer;
  v_character_kills jsonb;
  v_account_kills jsonb;
  v_best_claimed_tier integer;
  v_pet_exists boolean;
  v_player jsonb;
  v_active_event jsonb;
begin
  select to_jsonb(c), c.combat_last_resolved_at, c.selected_monster_id, c.account_id
  into v_old_character, v_old_resolved_at, v_selected_monster_id, v_account_id
  from public.characters c
  where c.id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.characters
  set combat_last_resolved_at = now()
  where id = p_character_id and combat_last_resolved_at = v_old_resolved_at;
  get diagnostics v_rows_updated = row_count;
  v_claimed := v_rows_updated > 0;

  if not v_claimed or v_selected_monster_id is null then
    return jsonb_build_object(
      'ok', true,
      'claimed', v_claimed,
      'character', v_old_character,
      'monster', null
    );
  end if;

  select to_jsonb(e) into v_monster from public.enemy_types e where e.id = v_selected_monster_id;

  if v_monster is null then
    return jsonb_build_object('ok', true, 'claimed', true, 'character', v_old_character, 'monster', null);
  end if;

  v_equipped_ids_no_quiver := array_remove(array[
    (v_old_character->>'equipped_weapon_id')::uuid,
    (v_old_character->>'equipped_ring_id')::uuid,
    (v_old_character->>'equipped_necklace_id')::uuid,
    (v_old_character->>'equipped_boots_id')::uuid,
    (v_old_character->>'equipped_hat_id')::uuid,
    (v_old_character->>'equipped_coat_id')::uuid
  ], null);

  v_equipped_ids_with_quiver := array_remove(
    array_append(v_equipped_ids_no_quiver, (v_old_character->>'equipped_quiver_id')::uuid),
    null
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ii.id,
    'quality_tier', ii.quality_tier,
    'template_id', ii.template_id,
    'composition_level', ii.composition_level,
    'durability', ii.durability,
    'base_stats', it.base_stats,
    'slot_type', it.slot_type,
    'required_level', it.required_level,
    'sockets', coalesce(ii.sockets, '[]'::jsonb)
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids_no_quiver);

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids_with_quiver))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select count(*) into v_potion_count
  from public.potion_stacks
  where character_id = p_character_id and count > 0;

  select count(*) into v_holding_count
  from public.loot_holding
  where character_id = p_character_id;

  select to_jsonb(k) into v_character_kills
  from public.character_monster_kills k
  where k.character_id = p_character_id and k.monster_id = v_selected_monster_id;

  select to_jsonb(a) into v_account_kills
  from public.account_monster_kills a
  where a.account_id = v_account_id and a.monster_id = v_selected_monster_id;

  select coalesce(max(claimed_tier_index), 0) into v_best_claimed_tier
  from public.account_monster_kills
  where account_id = v_account_id;

  select exists(
    select 1 from public.account_pets
    where account_id = v_account_id and monster_id = v_selected_monster_id
  ) into v_pet_exists;

  select to_jsonb(p) into v_player from public.players p where p.id = v_account_id;

  select jsonb_build_object('category', gp.buff_category, 'multiplier', gp.buff_multiplier)
  into v_active_event
  from public.gold_donation_state gs
  join public.gold_donation_pools gp on gp.id = gs.current_pool_id
  where gs.id = 1 and gp.status = 'active' and now() < gp.buff_ends_at;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'character', v_old_character,
    'monster', v_monster,
    'equipped_items', v_equipped_items,
    'gear_count', v_gear_count,
    'potion_count', v_potion_count,
    'holding_count', v_holding_count,
    'character_kills', v_character_kills,
    'account_kills', v_account_kills,
    'best_claimed_tier', v_best_claimed_tier,
    'pet_exists', v_pet_exists,
    'player', v_player,
    'active_event', v_active_event
  );
end;
$$;

revoke all on function public.resolve_combat_gather_state(uuid) from public;
grant execute on function public.resolve_combat_gather_state(uuid) to service_role;

-- ============================================================================
-- 7. promote_character -- full body from
--    20260901020000_promotion_item_adjustments.sql. Also excludes listed/
--    unclaimed-mailed items from v_owned_count (cost affordability) and the
--    v_ids consumption select, not just the award room-check v_gear_count --
--    an escrowed item shouldn't be spendable as a promotion cost either.
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
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
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
