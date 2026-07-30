-- Sell Item (confirmed with the user, 2026-07-30) — lets a player sell a gear
-- item from Inventory for gold, from the Shop tab. Mirrors the deposit_item/
-- withdraw_item pattern: item_instances has no client-side delete grant (only
-- select/insert — see 20260727040000_grant_item_table_privileges.sql), so this
-- has to go through a SECURITY DEFINER function rather than a raw client
-- delete, even though gold itself is otherwise client-authoritative (the same
-- reasoning as every other item_instances mutation this project has needed).
--
-- PLACEHOLDER sell-price formula, unresolved per CLAUDE.md like the rest of
-- this economy: half of the template's buy price, scaled by the same
-- QUALITY_STAT_MULTIPLIERS curve computeEquipmentBonus already uses for
-- stats (equipmentBonus.ts's previewSellPrice must stay in sync with this).
-- Composition level is deliberately ignored for now — a minimal first pass,
-- not a full item-valuation redesign.
create or replace function public.sell_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_price integer;
  v_multiplier numeric;
  v_sell_price integer;
  v_new_gold integer;
begin
  select owner_id, template_id, quality_tier into v_character_id, v_template_id, v_quality_tier
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

  select price into v_price from public.item_templates where id = v_template_id;

  v_multiplier := case v_quality_tier
    when 'normal' then 1
    when 'refined' then 1.1
    when 'unique' then 1.2
    when 'elite' then 1.35
    when 'super' then 1.5
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  delete from public.item_instances where id = item_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  return jsonb_build_object('ok', true, 'gold_gained', v_sell_price, 'gold', v_new_gold);
end;
$$;

revoke all on function public.sell_item(uuid) from public;
grant execute on function public.sell_item(uuid) to authenticated;
