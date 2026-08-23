-- Buy 5 / Buy 10 previously looped shop_buy_item client-side, one RPC
-- round-trip per item (reported by the user: buying 10 necklaces visibly
-- trickled in one at a time). This adds a real bulk RPC that does the whole
-- purchase loop server-side in one transaction/round-trip, stopping early
-- (same as the old client loop) the moment gold or room runs out. Discard-
-- to-make-room still only exists on the single-item shop_buy_item path —
-- an 'inventory_full' stop here just leaves pendingFullDrop set client-side
-- so the existing InventoryFullModal/discard flow still applies to the item
-- that didn't fit.
create or replace function public.shop_buy_item_bulk(
  p_character_id uuid,
  p_template_id uuid,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_class text;
  v_level integer;
  v_gold integer;
  v_price integer;
  v_required_level integer;
  v_required_class text;
  v_slot_type text;
  v_occupied integer;
  v_new_item public.item_instances%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_purchased integer := 0;
  v_stop_reason text := null;
  v_quantity integer := greatest(1, least(coalesce(p_quantity, 1), 25));
  i integer;
begin
  select account_id, class, level, gold
  into v_account_id, v_class, v_level, v_gold
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select price, required_level, required_class, slot_type
  into v_price, v_required_level, v_required_class, v_slot_type
  from public.item_templates
  where id = p_template_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;

  if v_required_class is not null and v_required_class <> v_class then
    return jsonb_build_object('ok', false, 'error', 'wrong_class');
  end if;

  if v_level < v_required_level then
    return jsonb_build_object('ok', false, 'error', 'level_too_low', 'required_level', v_required_level);
  end if;

  v_occupied := public.occupied_inventory_slots(p_character_id);

  for i in 1..v_quantity loop
    if v_gold < v_price then
      v_stop_reason := 'not_enough_gold';
      exit;
    end if;
    if v_occupied >= 40 then
      v_stop_reason := 'inventory_full';
      exit;
    end if;

    v_gold := v_gold - v_price;

    insert into public.item_instances (template_id, owner_id, level, durability)
    values (p_template_id, p_character_id, v_required_level, coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0))
    returning * into v_new_item;

    v_items := v_items || to_jsonb(v_new_item);
    v_occupied := v_occupied + 1;
    v_purchased := v_purchased + 1;
  end loop;

  if v_purchased = 0 then
    return jsonb_build_object('ok', false, 'error', coalesce(v_stop_reason, 'unknown'), 'gold', v_gold);
  end if;

  update public.characters set gold = v_gold where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'items', v_items,
    'purchased', v_purchased,
    'gold', v_gold,
    'stopped_reason', v_stop_reason
  );
end;
$$;

revoke all on function public.shop_buy_item_bulk(uuid, uuid, integer) from public;
grant execute on function public.shop_buy_item_bulk(uuid, uuid, integer) to authenticated;
