-- Lets a player sell a gear item straight out of Loot Holding for gold,
-- without first claiming it into Inventory (confirmed with the user,
-- 2026-07-31 -- the Loot Holding UI moved to an inventory-slot-style grid in
-- the same pass, see WarehousePanel.tsx's LootHoldingCard). Mirrors sell_item
-- exactly (same price formula, same "item_instances has no client delete
-- grant" reasoning -- loot_holding has no client delete grant either), just
-- operating on a loot_holding row instead of an item_instances row, and with
-- no ownership-ambiguity concern since a loot_holding row is never equipped.
--
-- Bug fix while touching this formula: sell_item's own v_multiplier case
-- statement was still using the pre-recalibration quality multipliers
-- (1/1.1/1.2/1.35/1.5) from before QUALITY_STAT_MULTIPLIERS was corrected to
-- 1/1.25/1.5/1.75/2 (see equipmentBonus.ts and CLAUDE.md's Gear system
-- section) -- a "must stay in sync" drift that was never caught because
-- nothing round-trip-tested a sell price against the client's own
-- previewSellPrice, which already used the corrected values. Both functions
-- now share the same corrected multipliers.
begin;

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
    when 'refined' then 1.25
    when 'unique' then 1.5
    when 'elite' then 1.75
    when 'super' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  delete from public.item_instances where id = item_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  return jsonb_build_object('ok', true, 'gold_gained', v_sell_price, 'gold', v_new_gold);
end;
$$;

-- ============================================================================
-- sell_loot_holding: same price formula as sell_item, applied to a pending
-- loot_holding row instead of a real item_instances row. Currency-type
-- entries (Meteor/DragonBall) have no template/price to sell against -- the
-- client only ever offers this action on gear entries, but it's rejected
-- server-side too, not just hidden client-side.
-- ============================================================================
create or replace function public.sell_loot_holding(holding_id uuid)
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
  v_currency_type text;
  v_price integer;
  v_multiplier numeric;
  v_sell_price integer;
  v_new_gold integer;
begin
  select character_id, template_id, quality_tier, currency_type
  into v_character_id, v_template_id, v_quality_tier, v_currency_type
  from public.loot_holding
  where id = holding_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_currency_type is not null then
    return jsonb_build_object('ok', false, 'error', 'not_sellable');
  end if;

  select price into v_price from public.item_templates where id = v_template_id;

  v_multiplier := case v_quality_tier
    when 'normal' then 1
    when 'refined' then 1.25
    when 'unique' then 1.5
    when 'elite' then 1.75
    when 'super' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  delete from public.loot_holding where id = holding_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  return jsonb_build_object('ok', true, 'gold_gained', v_sell_price, 'gold', v_new_gold);
end;
$$;

revoke all on function public.sell_loot_holding(uuid) from public;
grant execute on function public.sell_loot_holding(uuid) to authenticated;

commit;
