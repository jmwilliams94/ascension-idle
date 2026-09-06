-- Potions had no sell path at all (Use was the only action in the potion
-- tooltip) — adds a shop-side "Sell" for a potion stack. Sells the whole
-- stack in one call (matching how it's bought/displayed as one stack, unlike
-- gear's per-instance sell_item), for half of potion_type_info's price per
-- potion, same 0.5 multiplier sell_item uses for normal-quality gear.
-- Deliberately NOT folded into the "Sell All Normal" gear sweep (client-side
-- InventoryPanel change, not this migration) since potions aren't junk.
create or replace function public.sell_potion_stack(p_stack_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owner_character_id uuid;
  v_potion_type text;
  v_count integer;
  v_info record;
  v_sell_price integer;
  v_new_gold integer;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, potion_type, count
  into v_owner_character_id, v_potion_type, v_count
  from public.potion_stacks
  where id = p_stack_id
  for update;

  if not found or v_owner_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_count <= 0 then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  select * into v_info from public.potion_type_info(v_potion_type);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion_type');
  end if;

  v_sell_price := round(v_info.price * 0.5 * v_count);

  delete from public.potion_stacks where id = p_stack_id;

  update public.characters set gold = gold + v_sell_price where id = p_character_id
  returning gold into v_new_gold;

  return jsonb_build_object('ok', true, 'gold_gained', v_sell_price, 'gold', v_new_gold);
end;
$$;

revoke all on function public.sell_potion_stack(uuid, uuid) from public;
grant execute on function public.sell_potion_stack(uuid, uuid) to authenticated;
