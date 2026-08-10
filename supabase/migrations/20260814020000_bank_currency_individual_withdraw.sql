-- Account Bank's Comet/Fallen Star popup rework (2026-08-14, requested by
-- the user): the popup now offers an Individual/Scroll toggle instead of a
-- Deposit/Withdraw mode picker (Deposit for these two currencies still
-- exists elsewhere — the per-tile "Bank"/"Bank All" popover in Inventory —
-- just not from this Account Bank square anymore). Individual mode should
-- withdraw exactly the requested number of loose units with no auto-bundling
-- into Scrolls; Scroll mode already works unchanged today by requesting an
-- exact multiple of 10 (the existing auto-bundle logic below already turns
-- that into pure Scrolls with a zero remainder) — only the Individual case
-- needed new backend support, since transfer_currency's existing withdraw
-- path unconditionally bundles every full ten into a Scroll regardless of
-- what was asked for.
--
-- Adds a trailing `force_individual boolean default false` param — the old
-- 4-arg signature must be dropped first (create-or-replace with a different
-- arg list creates a second overload, not a replacement — the recurring
-- PostgREST-can't-disambiguate gotcha documented elsewhere in this project).
-- Deposit direction and every other existing caller (Inventory's per-tile
-- Bank/Bank All, Bank Scroll) are unaffected — they never pass the new
-- param, so it defaults to false and behavior is bit-for-bit identical to
-- before.
begin;

drop function if exists public.transfer_currency(uuid, text, integer, text);

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
        and not (id = any(v_equipped_ids));

      select coalesce(sum((value)::integer), 0) into v_stone_count
      from public.characters, jsonb_each_text(composition_stones)
      where id = character_id;

      select count(*) into v_potion_count
      from public.potion_stacks ps
      where ps.character_id = transfer_currency.character_id and ps.count > 0;

      v_occupied := v_gear_count + v_stone_count + v_potion_count
        + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

      if force_individual then
        -- Individual mode (2026-08-14) — every requested unit stays loose,
        -- no auto-bundling into Scrolls. Each unit is its own tile, so the
        -- room check is against the raw amount, not a bundled tile count.
        v_withdraw_scrolls := 0;
        v_withdraw_remainder := amount;
        v_tiles_needed := amount;
      else
        -- Bundle into Scrolls (10 units each) + a loose remainder, rather
        -- than one tile per unit — dramatically fewer tiles needed for a
        -- large withdrawal. Requesting an exact multiple of 10 (the "Scroll"
        -- mode UI path) naturally yields a zero remainder here, i.e. pure
        -- Scrolls, with no separate code path needed.
        v_withdraw_scrolls := amount / 10;
        v_withdraw_remainder := amount % 10;
        v_tiles_needed := v_withdraw_scrolls + v_withdraw_remainder;
      end if;

      v_free_slots := greatest(0, 40 - v_occupied);

      if v_tiles_needed > v_free_slots then
        return jsonb_build_object(
          'ok', false, 'error', 'not_enough_room',
          'occupied', v_occupied,
          -- Best case for "how many units could I withdraw right now" is all
          -- full Scrolls (10 units/tile) when bundling is allowed, or one
          -- unit per tile when it isn't — an approximation, same
          -- PLACEHOLDER-precision spirit as the rest of this economy, good
          -- enough for an error message's own hint text.
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

revoke all on function public.transfer_currency(uuid, text, integer, text, boolean) from public;
grant execute on function public.transfer_currency(uuid, text, integer, text, boolean) to authenticated;

commit;
