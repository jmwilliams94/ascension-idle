-- Adds gold_spent to shop_buy_pickaxe's response so the client can apply a
-- delta (addRewards(-gold_spent, 0)) instead of an absolute setGold overwrite
-- -- matches useProgressionStore's own documented reasoning for why gold
-- changes are deltas, not overwrites (an absolute value risks stomping a
-- concurrent gain from another source, e.g. a resolve-combat tick landing
-- between this RPC call and its response). Same signature, safe
-- create-or-replace.
begin;

create or replace function public.shop_buy_pickaxe(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_equipped_pickaxe_id uuid;
  v_gold integer;
  v_template_id uuid;
  v_price integer;
  v_new_gold integer;
  v_new_item public.item_instances%rowtype;
begin
  select account_id, equipped_pickaxe_id, gold
  into v_account_id, v_equipped_pickaxe_id, v_gold
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_equipped_pickaxe_id is not null then
    return jsonb_build_object('ok', false, 'error', 'already_owned');
  end if;

  select id, price into v_template_id, v_price
  from public.item_templates
  where item_family = 'pickaxe'
  order by required_level asc
  limit 1;

  if v_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;
  if v_gold < v_price then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'cost', v_price, 'gold', v_gold);
  end if;

  update public.characters set gold = gold - v_price where id = character_id
  returning gold into v_new_gold;

  insert into public.item_instances (template_id, owner_id, quality_tier, level, location)
  values (v_template_id, character_id, 'normal', 1, 'inventory')
  returning * into v_new_item;

  update public.characters set equipped_pickaxe_id = v_new_item.id where id = character_id;

  return jsonb_build_object('ok', true, 'item', to_jsonb(v_new_item), 'gold', v_new_gold, 'gold_spent', v_price);
end;
$$;

revoke all on function public.shop_buy_pickaxe(uuid) from public;
grant execute on function public.shop_buy_pickaxe(uuid) to authenticated;

commit;
