-- Gear drops now have a chance to roll in already at Composition +1
-- (confirmed with the user, 2026-08-12) -- an independent roll, at the same
-- conditional (given-a-drop) rate as the existing Infused quality roll
-- (1/16, see resolve-combat's QUALITY_DROP_CHANCES), scaled by the same
-- account-wide accountDropMultiplier. Layered on top of quality_tier, not a
-- replacement -- a dropped item can be e.g. Infused +1 at once.
--
-- loot_holding never had a composition_level column at all (offline/idle
-- drops always claimed in at +0) -- added here for parity so a +1 rolled
-- while away isn't silently lost at claim/store time.
begin;

alter table public.loot_holding
  add column if not exists composition_level integer not null default 0;

-- ============================================================================
-- claim_loot_holding -- now carries composition_level from the holding row
-- onto the real item_instances row it creates.
-- ============================================================================
create or replace function public.claim_loot_holding(holding_id uuid)
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
  v_composition_level integer;
  v_required_level integer;
  v_item jsonb;
  v_new_count integer;
begin
  select character_id, template_id, quality_tier, currency_type, composition_level
  into v_character_id, v_template_id, v_quality_tier, v_currency_type, v_composition_level
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
    if v_currency_type = 'meteor' then
      update public.characters set meteor_count = meteor_count + 1 where id = v_character_id
      returning meteor_count into v_new_count;
    else
      update public.characters set dragonball_count = dragonball_count + 1 where id = v_character_id
      returning dragonball_count into v_new_count;
    end if;

    delete from public.loot_holding where id = holding_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  select required_level into v_required_level from public.item_templates where id = v_template_id;

  insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level)
  values (v_template_id, v_character_id, v_quality_tier, coalesce(v_required_level, 1), coalesce(v_composition_level, 0))
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

-- ============================================================================
-- store_loot_holding_to_bank -- same addition.
-- ============================================================================
create or replace function public.store_loot_holding_to_bank(holding_id uuid)
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
  v_composition_level integer;
  v_required_level integer;
  v_item jsonb;
begin
  select character_id, template_id, quality_tier, currency_type, composition_level
  into v_character_id, v_template_id, v_quality_tier, v_currency_type, v_composition_level
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
    return jsonb_build_object('ok', false, 'error', 'not_storable_here');
  end if;

  select required_level into v_required_level from public.item_templates where id = v_template_id;

  insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level, location)
  values (v_template_id, v_character_id, v_quality_tier, coalesce(v_required_level, 1), coalesce(v_composition_level, 0), 'bank')
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

commit;
