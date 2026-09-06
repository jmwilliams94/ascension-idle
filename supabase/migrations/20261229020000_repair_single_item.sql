-- Single-item repair (2026-09-06, requested by the user) -- the Repair tab
-- has only ever had one flat "Repair All" action (see
-- 20260814000000_add_gear_durability.sql's header: "no per-item picker,
-- confirmed with the user"). Adds a per-item counterpart alongside it, not
-- instead of it. Mirrors repair_all_items' own ownership check/cost formula/
-- gold-deduction shape exactly, just scoped to one item_instances row.
begin;

create or replace function public.repair_item(p_character_id uuid, p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_gold integer;
  v_item record;
  v_max numeric;
  v_cost integer;
begin
  select account_id, gold into v_account_id, v_gold
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select ii.id, ii.durability, ii.quality_tier, it.slot_type, it.required_level
  into v_item
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = p_item_id and ii.owner_id = p_character_id
  for update of ii;

  if not found or v_item.slot_type = 'quiver' then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  v_max := public.compute_max_durability(v_item.slot_type, v_item.required_level);

  if v_max is null or v_item.durability >= v_max then
    return jsonb_build_object('ok', false, 'error', 'already_full');
  end if;

  v_cost := public.compute_repair_cost(v_item.required_level, v_item.quality_tier, v_item.durability, v_max);

  if v_gold < v_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'cost', v_cost, 'gold', v_gold);
  end if;

  update public.characters set gold = gold - v_cost where id = p_character_id
  returning gold into v_gold;

  update public.item_instances set durability = v_max where id = p_item_id;

  return jsonb_build_object(
    'ok', true,
    'gold_spent', v_cost,
    'gold_remaining', v_gold,
    'item', jsonb_build_object('id', p_item_id, 'durability', v_max)
  );
end;
$$;

revoke all on function public.repair_item(uuid, uuid) from public;
grant execute on function public.repair_item(uuid, uuid) to authenticated;

commit;
