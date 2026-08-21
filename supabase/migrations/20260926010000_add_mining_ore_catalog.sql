-- Mining mechanic, step 1 continued — Ore catalog. 30 real item_templates
-- rows (Iron/Silver/Gold x Rank 1-10), each a distinct sellable Inventory
-- item rather than a fungible jsonb counter (deliberately NOT the
-- composition_stones/gems pattern — ore drops need individually meaningful
-- names/values). Dropped as real item_instances rows on a mining kill, sold
-- via the existing, unmodified sell_item(item_id) RPC — quality_tier stays
-- 'normal' (multiplier 1) for the whole lifetime of an ore item, so
-- sell_item's `price * 0.5 * quality_multiplier` formula reduces to a flat
-- half-price sale with zero new sell code needed.
--
-- price = rank * BASE_VALUE[type], placeholder scaling, tunable:
--   iron BASE_VALUE=20 (20-200g), silver=35 (35-350g), gold=60 (60-600g).
begin;

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class, price)
select 'Iron Ore (Rank ' || rank || ')', 'material', 'ore', '{}'::jsonb, 1, null, rank * 20
from generate_series(1, 10) as rank
where not exists (
  select 1 from public.item_templates where name = 'Iron Ore (Rank ' || rank || ')' and item_family = 'ore'
);

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class, price)
select 'Silver Ore (Rank ' || rank || ')', 'material', 'ore', '{}'::jsonb, 1, null, rank * 35
from generate_series(1, 10) as rank
where not exists (
  select 1 from public.item_templates where name = 'Silver Ore (Rank ' || rank || ')' and item_family = 'ore'
);

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class, price)
select 'Gold Ore (Rank ' || rank || ')', 'material', 'ore', '{}'::jsonb, 1, null, rank * 60
from generate_series(1, 10) as rank
where not exists (
  select 1 from public.item_templates where name = 'Gold Ore (Rank ' || rank || ')' and item_family = 'ore'
);

-- Neither Pickaxe nor Ore should ever roll as a monster kill drop — same
-- exclusion list client-side NON_DROPPABLE_FAMILIES mirrors (useInventoryStore.ts).
create or replace function public.pick_drop_template(p_class text, p_level integer)
returns jsonb
language plpgsql
as $$
declare
  v_family text;
  v_result jsonb;
begin
  select item_family into v_family
  from public.item_templates
  where item_family is not null
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag', 'promotion-gear', 'promotion-material', 'pickaxe', 'ore')
    and (required_class is null or required_class = p_class)
  group by item_family
  order by random()
  limit 1;

  if v_family is null then
    return null;
  end if;

  select jsonb_build_object('id', id, 'required_level', required_level, 'slot_type', slot_type)
  into v_result
  from public.item_templates
  where item_family = v_family
    and (required_class is null or required_class = p_class)
  order by abs(required_level - p_level)
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.pick_drop_template(text, integer) from public;
grant execute on function public.pick_drop_template(text, integer) to service_role;

commit;
