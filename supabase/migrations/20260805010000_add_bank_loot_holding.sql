-- Adds a way to get a stuck Comet/Fallen Star Loot Holding entry out of the
-- way without needing Inventory room (confirmed with the user, 2026-08-05:
-- "I just got to one of the claim screens and I couldn't claim my comets
-- cause of a full inventory... let's add a bank button for comets and
-- fallen stars so if our inventory is full we have the option to bank
-- them"). claim_loot_holding requires a free Inventory slot even for a
-- currency-type entry, since a claimed Comet/Fallen Star becomes its own
-- non-stacking Inventory tile (see CLAUDE.md's Loot section) — with no way
-- to sell a currency entry (sell_loot_holding rejects them outright with
-- 'not_sellable', since only gear has a price) and OfflineProgressModal
-- deliberately staying open on any claim failure (a 2026-08-05 fix so
-- stuck entries don't silently vanish and reappear confusingly later — see
-- CLAUDE.md), a player with a genuinely full Inventory had no way to ever
-- get past that screen at all.
--
-- bank_loot_holding routes a currency-type entry straight into the
-- account-wide swap-model Bank (players.bank_comets/bank_fallen_stars —
-- the same balance transfer_currency already reads/writes) instead of the
-- character's own comet_count/fallen_star_count, so it never touches
-- Inventory at all. Same ownership-check shape as claim_loot_holding
-- (character_id -> account_id -> auth.uid()); rejects gear entries
-- outright with 'not_bankable' since gear has no equivalent account-wide
-- currency form to become.
create or replace function public.bank_loot_holding(holding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_currency_type text;
  v_account_id uuid;
  v_new_bank_balance integer;
begin
  select character_id, currency_type
  into v_character_id, v_currency_type
  from public.loot_holding
  where id = holding_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_currency_type is null then
    return jsonb_build_object('ok', false, 'error', 'not_bankable');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_currency_type = 'comet' then
    update public.players set bank_comets = bank_comets + 1 where id = v_account_id
    returning bank_comets into v_new_bank_balance;
  else
    update public.players set bank_fallen_stars = bank_fallen_stars + 1 where id = v_account_id
    returning bank_fallen_stars into v_new_bank_balance;
  end if;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_bank_balance', v_new_bank_balance);
end;
$$;

revoke all on function public.bank_loot_holding(uuid) from public;
grant execute on function public.bank_loot_holding(uuid) to authenticated;
