-- Fixes item_instances.level defaulting to 1 on every fresh grant, regardless
-- of which template tier the item actually is (e.g. a level-125-required
-- "Glacial Coat" displaying as "Lv 1"). level is meant to track which real
-- tier an item is at — a successful Level Upgrade already sets it to the next
-- template's required_level (see 20260730020000_level_upgrade_next_tier.sql),
-- but every *initial* grant path left it at the schema default instead. This
-- fixes claim_loot_holding specifically (the client-side grantItemDrop path
-- and the resolve-combat Edge Function were fixed alongside this migration).
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
  v_required_level integer;
  v_item jsonb;
begin
  select character_id, template_id, quality_tier
  into v_character_id, v_template_id, v_quality_tier
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

  select required_level into v_required_level from public.item_templates where id = v_template_id;

  insert into public.item_instances (template_id, owner_id, quality_tier, level)
  values (v_template_id, v_character_id, v_quality_tier, coalesce(v_required_level, 1))
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

revoke all on function public.claim_loot_holding(uuid) from public;
grant execute on function public.claim_loot_holding(uuid) to authenticated;
