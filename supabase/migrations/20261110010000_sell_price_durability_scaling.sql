-- Sell price now scales with the item's current durability (requested by the
-- user, 2026-08-29) — a worn item should sell for proportionally less, not
-- the same flat price regardless of condition. "Sells for X" in the new
-- price rescale (20261110000000) means X at full durability; this migration
-- is what actually makes that true. Body is otherwise an unchanged copy of
-- the latest version (20260930010000_gear_lock_and_gear_score.sql) — same
-- signature, plain replace, no drop needed.
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
  v_locked boolean;
  v_durability numeric;
  v_slot_type text;
  v_required_level integer;
  v_price integer;
  v_multiplier numeric;
  v_max_durability numeric;
  v_durability_fraction numeric;
  v_sell_price integer;
  v_new_gold integer;
begin
  select owner_id, template_id, quality_tier, locked, durability
  into v_character_id, v_template_id, v_quality_tier, v_locked, v_durability
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

  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'item_locked');
  end if;

  select price, slot_type, required_level into v_price, v_slot_type, v_required_level
  from public.item_templates where id = v_template_id;

  v_multiplier := case v_quality_tier
    when 'normal' then 1
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;

  v_max_durability := public.compute_max_durability(v_slot_type, v_required_level);
  v_durability_fraction := case
    when v_max_durability is null or v_max_durability <= 0 then 1
    else least(1, coalesce(v_durability, 0) / v_max_durability)
  end;

  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier * v_durability_fraction);

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

revoke all on function public.sell_item(uuid) from public;
grant execute on function public.sell_item(uuid) to authenticated;
