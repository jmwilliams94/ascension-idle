-- Rescale gear repair cost (2026-08-14, requested by the user: "level 130
-- gear should cost like 100k per piece if their durability is at 0... early
-- gear should cost around 5k to 10k"). Previously a flat, low
-- (2 gold * level * quality multiplier) charge applied in full the moment an
-- item was even slightly damaged. Now:
--   1. A fully-broken (0 durability) Normal-quality item's cost climbs
--      geometrically from 7,500 (level 1) to 100,000 (level 130) — same
--      log-scale-interpolation style the client's EXP_CURVE_ANCHORS already
--      uses — then scaled by the existing QUALITY_STAT_MULTIPLIERS table.
--   2. Cost then scales down proportionally by how much durability is
--      actually missing, so a lightly-worn item costs much less than a
--      fully-broken one, rather than the same flat price either way.
-- Mirrors src/game/items/equipmentBonus.ts's computeRepairCost exactly —
-- keep in sync.
begin;

-- Signature gains two new params (current/max durability) — the old 2-arg
-- version must be dropped first (create-or-replace with a different arg
-- list creates a second overload, not a replacement — the recurring
-- PostgREST-can't-disambiguate gotcha documented elsewhere in this project).
drop function if exists public.compute_repair_cost(integer, text);

create or replace function public.compute_repair_cost(
  required_level integer,
  quality_tier text,
  current_durability numeric,
  max_durability numeric
)
returns integer
language plpgsql
as $$
declare
  v_multiplier numeric;
  v_t numeric;
  v_full_break_cost numeric;
  v_missing_fraction numeric;
begin
  if max_durability is null or max_durability <= 0 then
    return 0;
  end if;

  v_multiplier := case quality_tier
    when 'normal' then 1
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;

  v_t := greatest(0, least(1, (required_level - 1)::numeric / 129));
  v_full_break_cost := 7500 * power(100000.0 / 7500, v_t);

  v_missing_fraction := greatest(0, least(1, (max_durability - current_durability) / max_durability));

  return round(v_full_break_cost * v_multiplier * v_missing_fraction)::integer;
end;
$$;

revoke all on function public.compute_repair_cost(integer, text, numeric, numeric) from public;

-- repair_all_items now passes the item's own current/max durability through
-- (v_max was already computed per-item in its loop) — otherwise unchanged.
create or replace function public.repair_all_items(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_gold integer;
  v_total_cost integer := 0;
  v_count integer := 0;
  v_repaired jsonb := '[]'::jsonb;
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

  for v_item in
    select ii.id, ii.durability, ii.quality_tier, it.slot_type, it.required_level
    from public.item_instances ii
    join public.item_templates it on it.id = ii.template_id
    where ii.owner_id = p_character_id
      and it.slot_type <> 'quiver'
    for update of ii
  loop
    v_max := public.compute_max_durability(v_item.slot_type, v_item.required_level);

    if v_max is null or v_item.durability >= v_max then
      continue;
    end if;

    v_cost := public.compute_repair_cost(v_item.required_level, v_item.quality_tier, v_item.durability, v_max);
    v_total_cost := v_total_cost + v_cost;
    v_count := v_count + 1;
    v_repaired := v_repaired || jsonb_build_object('id', v_item.id, 'durability', v_max);
  end loop;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'already_full');
  end if;

  if v_gold < v_total_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'cost', v_total_cost, 'gold', v_gold);
  end if;

  update public.characters set gold = gold - v_total_cost where id = p_character_id
  returning gold into v_gold;

  update public.item_instances ii
  set durability = (r ->> 'durability')::numeric
  from jsonb_array_elements(v_repaired) as r
  where ii.id = (r ->> 'id')::uuid and ii.owner_id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'gold_spent', v_total_cost,
    'gold_remaining', v_gold,
    'items_repaired', v_count,
    'repaired_items', v_repaired
  );
end;
$$;

revoke all on function public.repair_all_items(uuid) from public;
grant execute on function public.repair_all_items(uuid) to authenticated;

commit;
