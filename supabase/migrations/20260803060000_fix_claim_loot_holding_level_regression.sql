-- Bug fix: claim_loot_holding was granting every claimed gear item at level 1,
-- regardless of its actual template — e.g. a level-15 Fawnhide Coat would show
-- as "Lv 1" (with correctly-scaled level-15 stats, since stats come from the
-- template's base_stats, not the level number) once claimed from Loot Holding,
-- even though it looked correct at every other stage.
--
-- Root cause: 20260730070000_fix_item_level_on_grant.sql originally fixed this
-- (looking up required_level and setting it on insert), but the very next
-- migration, 20260731050000_meteor_dragonball_inventory_items.sql, rewrote
-- claim_loot_holding from scratch to add Meteor/DragonBall currency claims —
-- and that rewrite silently dropped the level fix, reverting to the original
-- bug. This migration reapplies it on top of the current (currency-aware)
-- version rather than reverting the currency support.
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
  v_required_level integer;
  v_item jsonb;
  v_new_count integer;
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

  insert into public.item_instances (template_id, owner_id, quality_tier, level)
  values (v_template_id, v_character_id, v_quality_tier, coalesce(v_required_level, 1))
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;
