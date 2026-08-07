-- Forge Salvage tab (confirmed with the user, 2026-08-07): a way to turn
-- unwanted quality gear directly into Ascension Points, no gold involved.
-- Distinct from sell_item (which already grants a small amount of AP
-- alongside gold for tempered+ gear, see 20260730060000_add_sell_item.sql) —
-- Salvage forfeits the gold entirely in exchange for roughly double the AP
-- sell_item would grant for the same item, so it's a genuine choice (gold +
-- a little AP via Sell, vs. more AP and no gold via Salvage) rather than a
-- strictly worse option. Normal-tier gear still salvages for a token 1 AP
-- (unlike sell_item's 0) since this tab's whole purpose is extracting AP
-- value, not a subset of Sell's behavior. PLACEHOLDER economy numbers, same
-- disclosed-not-final status as every other reward table in this game.
create or replace function public.salvage_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_quality_tier text;
  v_ap_gained integer;
  v_new_ap integer;
begin
  select owner_id, quality_tier into v_character_id, v_quality_tier
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_ap_gained := case v_quality_tier
    when 'normal' then 1
    when 'tempered' then 2
    when 'infused' then 4
    when 'radiant' then 6
    when 'ascended' then 8
    else 1
  end;

  delete from public.item_instances where id = item_id;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;

revoke all on function public.salvage_item(uuid) from public;
grant execute on function public.salvage_item(uuid) to authenticated;
