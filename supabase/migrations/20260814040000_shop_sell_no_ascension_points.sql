-- Ascension Points removed from Shop/Loot-Holding "Sell" (2026-08-14,
-- requested by the user): sell_item and sell_loot_holding used to grant AP
-- on quality gear (Tempered +1/Infused +2/Radiant +3/Ascended +4, same table
-- as Salvage's own payout) on top of gold. AP should only ever come from
-- Salvage (salvage_item, untouched by this migration) now — Sell is gold-
-- only. Same-signature create-or-replace on both, no drop needed.
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
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  delete from public.item_instances where id = item_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold
  );
end;
$$;

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
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  delete from public.loot_holding where id = holding_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold
  );
end;
$$;

commit;
