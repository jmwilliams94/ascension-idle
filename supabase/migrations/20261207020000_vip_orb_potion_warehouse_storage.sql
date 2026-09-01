-- Supersedes 20261207010000_vip_orb_potion_tradeable_bankable.sql's Bank
-- mechanism for VIP Token/Experience Orb/Experience Potion -- the user
-- clarified they meant the physical account-wide Storage grid ("the
-- warehouse" colloquially -- the whole Bank tab was literally called
-- "Warehouse" before the 2026-08-02 rename, see
-- 20260803100000_rename_warehouse_points_to_bank_points.sql's own comment),
-- not a numeric Bank balance. That prior migration's players.bank_vip_tokens/
-- bank_experience_orbs/bank_experience_potions columns and transfer_currency's
-- 3 new branches were never used in production (superseded same-day) -- this
-- drops/reverts them and replaces with the same shape Comet/Fallen Star's own
-- physical Storage already uses: bank_currency_item (both directions --
-- unlike Comet/Fallen Star, whose deposit direction is UI-retired but still
-- exists server-side) plus a `<x>_bank_count` column per type, rendered as
-- physical tiles in BankGrid.tsx, same 40-slot BANK_SLOT_CAP as gear.
begin;

-- ============================================================================
-- 1. players -- drop the balance columns, add the physical-storage-shaped
--    ones instead (matching comet_bank_count/fallen_star_bank_count).
-- ============================================================================
alter table public.players drop constraint if exists players_bank_vip_tokens_check;
alter table public.players drop column if exists bank_vip_tokens;
alter table public.players drop constraint if exists players_bank_experience_orbs_check;
alter table public.players drop column if exists bank_experience_orbs;
alter table public.players drop constraint if exists players_bank_experience_potions_check;
alter table public.players drop column if exists bank_experience_potions;

alter table public.players add column if not exists vip_token_bank_count integer not null default 0;
alter table public.players add constraint players_vip_token_bank_count_check check (vip_token_bank_count >= 0);
alter table public.players add column if not exists experience_orb_bank_count integer not null default 0;
alter table public.players add constraint players_experience_orb_bank_count_check check (experience_orb_bank_count >= 0);
alter table public.players add column if not exists experience_potion_bank_count integer not null default 0;
alter table public.players add constraint players_experience_potion_bank_count_check check (experience_potion_bank_count >= 0);

-- ============================================================================
-- 2. transfer_currency -- reverted to the pre-20261207010000 version (gold/
--    comets/fallen_stars only), full-body copy from
--    20261031000000_bank_and_promotion_pickaxe_room_check.sql.
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
-- 3. bank_currency_item -- widen to the 3 new types, same shape as comet/
--    fallen_star (deposit/withdraw between characters.<x>_count and
--    players.<x>_bank_count). Same argument list/names as today, so no
--    drop function needed.
-- ============================================================================
create or replace function public.bank_currency_item(
  character_id uuid,
  currency_type text,
  direction text,
  amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_count integer;
  v_bank_count integer;
begin
  if currency_type not in ('comet', 'fallen_star', 'vip_token', 'experience_orb', 'experience_potion') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;
  if amount is null or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_account_id from public.characters where id = character_id for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if currency_type = 'comet' then
    select comet_count into v_count from public.characters where id = character_id;
    select comet_bank_count into v_bank_count from public.players where id = v_account_id for update;
  elsif currency_type = 'fallen_star' then
    select fallen_star_count into v_count from public.characters where id = character_id;
    select fallen_star_bank_count into v_bank_count from public.players where id = v_account_id for update;
  elsif currency_type = 'vip_token' then
    select vip_token_count into v_count from public.characters where id = character_id;
    select vip_token_bank_count into v_bank_count from public.players where id = v_account_id for update;
  elsif currency_type = 'experience_orb' then
    select experience_orb_count into v_count from public.characters where id = character_id;
    select experience_orb_bank_count into v_bank_count from public.players where id = v_account_id for update;
  else
    select experience_potion_count into v_count from public.characters where id = character_id;
    select experience_potion_bank_count into v_bank_count from public.players where id = v_account_id for update;
  end if;

  if direction = 'deposit' then
    if v_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_count := v_count - amount;
    v_bank_count := v_bank_count + amount;
  else
    if v_bank_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_bank_count := v_bank_count - amount;
    v_count := v_count + amount;
  end if;

  if currency_type = 'comet' then
    update public.characters set comet_count = v_count where id = character_id;
    update public.players set comet_bank_count = v_bank_count where id = v_account_id;
  elsif currency_type = 'fallen_star' then
    update public.characters set fallen_star_count = v_count where id = character_id;
    update public.players set fallen_star_bank_count = v_bank_count where id = v_account_id;
  elsif currency_type = 'vip_token' then
    update public.characters set vip_token_count = v_count where id = character_id;
    update public.players set vip_token_bank_count = v_bank_count where id = v_account_id;
  elsif currency_type = 'experience_orb' then
    update public.characters set experience_orb_count = v_count where id = character_id;
    update public.players set experience_orb_bank_count = v_bank_count where id = v_account_id;
  else
    update public.characters set experience_potion_count = v_count where id = character_id;
    update public.players set experience_potion_bank_count = v_bank_count where id = v_account_id;
  end if;

  return jsonb_build_object('ok', true, 'count', v_count, 'bank_count', v_bank_count);
end;
$$;

commit;
