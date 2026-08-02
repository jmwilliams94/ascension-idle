-- Ascension Points (AP) -- a new per-character currency, confirmed with the
-- user (2026-08-02) to fund the upcoming Marketplace (see
-- 20260802050000_add_marketplace.sql). Named after the game's own title,
-- distinct from the confirmed-but-unbuilt "Ascend" level-130 reset mechanic
-- (CLAUDE.md's Progression section) -- this currency's earn source is
-- unrelated to that system, at the user's explicit choice.
--
-- The ONLY way to earn AP, for this pass: selling quality gear to the Shop
-- (or straight out of Loot Holding overflow) awards AP based on the sold
-- item's quality tier -- Tempered +1, Infused +2, Radiant +3, Ascended +4,
-- Normal +0. No other earn source exists yet.
--
-- Server-authoritative only, same trust model as meteor_count/dragonball_
-- count (see useCurrencyStore.ts) -- it funds cross-account Marketplace
-- purchases, so it must never be part of the generic character autosave;
-- the client only ever reflects what an RPC's response says.
begin;

alter table public.characters add column if not exists ascension_points integer not null default 0;

-- CREATE OR REPLACE both sell functions (currently defined together in
-- 20260731100000_sell_loot_holding.sql) to award AP alongside gold. The
-- existing v_multiplier (quality->gold multiplier) is untouched -- this only
-- adds the AP side effect on top of the existing gold formula.
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
  v_ap_gained integer;
  v_new_gold integer;
  v_new_ap integer;
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

  v_ap_gained := case v_quality_tier
    when 'refined' then 1
    when 'unique' then 2
    when 'elite' then 3
    when 'super' then 4
    else 0
  end;

  delete from public.item_instances where id = item_id;

  update public.characters
    set gold = gold + v_sell_price, ascension_points = ascension_points + v_ap_gained
    where id = v_character_id
  returning gold, ascension_points into v_new_gold, v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
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
  v_ap_gained integer;
  v_new_gold integer;
  v_new_ap integer;
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

  v_ap_gained := case v_quality_tier
    when 'refined' then 1
    when 'unique' then 2
    when 'elite' then 3
    when 'super' then 4
    else 0
  end;

  delete from public.loot_holding where id = holding_id;

  update public.characters
    set gold = gold + v_sell_price, ascension_points = ascension_points + v_ap_gained
    where id = v_character_id
  returning gold, ascension_points into v_new_gold, v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;

revoke all on function public.sell_item(uuid) from public;
grant execute on function public.sell_item(uuid) to authenticated;
revoke all on function public.sell_loot_holding(uuid) from public;
grant execute on function public.sell_loot_holding(uuid) to authenticated;

commit;
