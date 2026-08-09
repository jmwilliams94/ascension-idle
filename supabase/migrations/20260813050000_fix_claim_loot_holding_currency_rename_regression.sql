-- Fix: claiming a currency-type Loot Holding entry (a Comet or Fallen Star
-- picked up while offline) failed unconditionally -- reported by the user
-- ("My inventory is 6/40 and I can't claim 1 comet... unrelated to the
-- change we just made though" -- correct, this is a separate bug).
--
-- Root cause: same class of regression as the gear_composition_points fix
-- earlier today. 20260803090000_rename_meteor_dragonball_to_comet_fallen_star.sql
-- renamed characters.meteor_count/dragonball_count to comet_count/
-- fallen_star_count and updated claim_loot_holding to match. But
-- 20260812000000_composition_plus_one_drops.sql's create-or-replace of
-- claim_loot_holding (adding composition_level carry-through) was apparently
-- based on an older, pre-rename copy of the function -- it references
-- meteor_count/dragonball_count and the literal 'meteor' currency_type
-- value, none of which exist anymore (loot_holding.currency_type only ever
-- allows 'comet'/'fallen_star' -- see its own check constraint). Every
-- currency claim hit a plain "column does not exist" Postgres error. Gear
-- claims were unaffected (different branch, no currency columns touched).
--
-- Fix: restore the comet/fallen_star naming, keeping composition_level
-- carry-through (correct, not regressed).
begin;

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
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + 1 where id = v_character_id
      returning comet_count into v_new_count;
    else
      update public.characters set fallen_star_count = fallen_star_count + 1 where id = v_character_id
      returning fallen_star_count into v_new_count;
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

revoke all on function public.claim_loot_holding(uuid) from public;
grant execute on function public.claim_loot_holding(uuid) to authenticated;

commit;
