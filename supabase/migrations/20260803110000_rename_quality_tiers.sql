-- Phase 2c of the full internal rename pass (confirmed with the user,
-- 2026-08-03, alongside Meteor/DragonBall -> Comet/Fallen Star and
-- Warehouse -> Bank -- see CLAUDE.md). Quality tier internal values
-- refined/unique/elite/super -> tempered/infused/radiant/ascended, matching
-- their already-renamed display labels (QUALITY_LABELS in equipmentBonus.ts
-- has said Tempered/Infused/Radiant/Ascended since a much earlier display-
-- only pass -- 'normal' is unchanged, nobody flagged that one). Not a
-- Postgres enum type -- item_instances.quality_tier is text + a CHECK
-- constraint, so this is a data UPDATE + constraint swap, no ALTER TYPE
-- needed. loot_holding.quality_tier has no CHECK constraint at all, just
-- needs the data UPDATE.
--
-- Explicit landmine, confirmed clear before writing this migration: 'unique'
-- is also the ubiquitous SQL keyword used in dozens of `unique (...)` table
-- constraints throughout this project's migrations -- none of those are
-- touched here, only the literal quality-tier VALUE 'unique' wherever it's
-- compared/assigned as a quality_tier string.
begin;

alter table public.item_instances drop constraint if exists item_instances_quality_tier_check;

update public.item_instances set quality_tier = case quality_tier
  when 'refined' then 'tempered'
  when 'unique' then 'infused'
  when 'elite' then 'radiant'
  when 'super' then 'ascended'
  else quality_tier
end;

alter table public.item_instances
  add constraint item_instances_quality_tier_check
  check (quality_tier in ('normal', 'tempered', 'infused', 'radiant', 'ascended'));

update public.loot_holding set quality_tier = case quality_tier
  when 'refined' then 'tempered'
  when 'unique' then 'infused'
  when 'elite' then 'radiant'
  when 'super' then 'ascended'
  else quality_tier
end;

-- ============================================================================
-- quality_upgrade -- tier-progression chain renamed. Cost/success-chance/
-- socket-roll logic and the Comet/Fallen Star naming (from the earlier phase
-- of this same rename pass) are unchanged.
-- ============================================================================
create or replace function public.quality_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_tier text;
  v_next_tier text;
  v_template_id uuid;
  v_slot_type text;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric := 0.7;
  v_socket_roll_chance numeric := 0.01;
  v_fallen_stars integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, fallen_star_count into v_account_id, v_fallen_stars
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type into v_slot_type from public.item_templates where id = v_template_id;

  v_next_tier := case v_current_tier
    when 'normal' then 'tempered'
    when 'tempered' then 'infused'
    when 'infused' then 'radiant'
    when 'radiant' then 'ascended'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  if v_fallen_stars < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_fallen_stars',
      'cost', v_cost,
      'fallen_stars', v_fallen_stars
    );
  end if;

  update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'fallen_stars_spent', v_cost,
    'fallen_stars_remaining', v_fallen_stars - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- sell_item / sell_loot_holding -- gold multiplier + AP-gained case chains
-- renamed. Everything else (Ascension Points crediting the account row, not
-- the character) is unchanged from the 2026-08-03 account-wide correction.
-- ============================================================================
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
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  v_ap_gained := case v_quality_tier
    when 'tempered' then 1
    when 'infused' then 2
    when 'radiant' then 3
    when 'ascended' then 4
    else 0
  end;

  delete from public.item_instances where id = item_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

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
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  v_ap_gained := case v_quality_tier
    when 'tempered' then 1
    when 'infused' then 2
    when 'radiant' then 3
    when 'ascended' then 4
    else 0
  end;

  delete from public.loot_holding where id = holding_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;

commit;
