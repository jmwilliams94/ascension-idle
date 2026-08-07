-- Bank withdrawal now bundles Comets/Fallen Stars into Scrolls instead of
-- always granting loose, non-stacking tiles (confirmed with the user,
-- 2026-08-07) — withdrawing 25, for example, now grants 2 Comet Scrolls (20)
-- + 5 loose Comets (7 Inventory tiles) instead of 25 individual tiles.
-- Deliberately Comet/Fallen-Star-only, per the user ("these bundles will
-- only apply to comets and fallen stars") — Gold has no tile representation
-- at all, and Composition Stones/gear withdrawal (bank_stone_item,
-- withdraw_item_from_storage, withdraw_gear_composition) stay single-item,
-- untouched by this migration.
--
-- The room check below is rewritten to size against TILES needed (scrolls +
-- remainder loose units), not raw unit amount — this is the whole point of
-- bundling: it lets a withdrawal that wouldn't have fit as loose units (e.g.
-- 25 loose tiles) fit easily as bundled ones (7 tiles).
create or replace function public.transfer_currency(character_id uuid, currency text, amount integer, direction text)
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
        and not (id = any(v_equipped_ids));

      select coalesce(sum((value)::integer), 0) into v_stone_count
      from public.characters, jsonb_each_text(composition_stones)
      where id = character_id;

      select count(*) into v_potion_count
      from public.potion_stacks ps
      where ps.character_id = transfer_currency.character_id and ps.count > 0;

      v_occupied := v_gear_count + v_stone_count + v_potion_count
        + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

      -- Bundle into Scrolls (10 units each) + a loose remainder, rather than
      -- one tile per unit — dramatically fewer tiles needed for a large
      -- withdrawal.
      v_withdraw_scrolls := amount / 10;
      v_withdraw_remainder := amount % 10;
      v_tiles_needed := v_withdraw_scrolls + v_withdraw_remainder;
      v_free_slots := greatest(0, 40 - v_occupied);

      if v_tiles_needed > v_free_slots then
        return jsonb_build_object(
          'ok', false, 'error', 'not_enough_room',
          'occupied', v_occupied,
          -- Best case for "how many units could I withdraw right now" is all
          -- full Scrolls (10 units/tile) — an approximation, same
          -- PLACEHOLDER-precision spirit as the rest of this economy, good
          -- enough for an error message's own hint text.
          'max_withdrawable', v_free_slots * 10
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
