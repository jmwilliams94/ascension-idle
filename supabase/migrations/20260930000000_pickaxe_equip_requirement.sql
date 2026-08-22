-- Pickaxe equip/unequip (requested by the user) — introduces a genuine
-- equipped-vs-owned distinction that didn't exist before: previously a
-- Pickaxe was equipped the instant it was bought and never unequipped again
-- (characters.equipped_pickaxe_id only ever went null->set, never back).
-- Now the player can deliberately unequip it, and doing so (a) is required
-- to be reversed before Mining can start, and (b) stops an active mining
-- session immediately if it happens mid-session (client-side, see
-- pickaxeEquipActions.ts — this migration only handles the server side of
-- "can it be un/re-equipped and does ownership still check out").
--
-- Every other Pickaxe RPC (pickaxe_tier_upgrade, shop_buy_pickaxe) used to
-- key off equipped_pickaxe_id directly, which stops being correct the
-- moment "owned" and "equipped" can diverge: Tier Up should keep working on
-- an unequipped Pickaxe (mirrors how normal gear's Forge actions don't
-- require the item to be worn), and shop_buy_pickaxe's "already own one"
-- check must not let an unequipped owner buy a second. Both switched from
-- "equipped_pickaxe_id is set" to "an owned item_instances row with
-- item_family = 'pickaxe' exists" — the real, equip-state-independent
-- ownership test.
begin;

-- Guaranteed-success unequip — always sets equipped_pickaxe_id to null,
-- regardless of its current value (idempotent, mirrors unequip_pickaxe's
-- own "no unequip-of-nothing to fail on" simplicity).
create or replace function public.unequip_pickaxe(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.characters where id = character_id for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.characters set equipped_pickaxe_id = null where id = character_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unequip_pickaxe(uuid) from public;
grant execute on function public.unequip_pickaxe(uuid) to authenticated;

-- Re-equips the character's owned Pickaxe (idempotent if already equipped).
-- Refuses with 'no_pickaxe_owned' if they've never bought one at all, same
-- error family pickaxe_tier_upgrade/resolve_mining_gather_state already use.
create or replace function public.equip_pickaxe(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_equipped_pickaxe_id uuid;
  v_owned_pickaxe_id uuid;
begin
  select account_id, equipped_pickaxe_id into v_account_id, v_equipped_pickaxe_id
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
    return jsonb_build_object('ok', true, 'item_id', v_equipped_pickaxe_id);
  end if;

  select ii.id into v_owned_pickaxe_id
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.owner_id = character_id and it.item_family = 'pickaxe'
  limit 1;

  if v_owned_pickaxe_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pickaxe_owned');
  end if;

  update public.characters set equipped_pickaxe_id = v_owned_pickaxe_id where id = character_id;

  return jsonb_build_object('ok', true, 'item_id', v_owned_pickaxe_id);
end;
$$;

revoke all on function public.equip_pickaxe(uuid) from public;
grant execute on function public.equip_pickaxe(uuid) to authenticated;

-- pickaxe_tier_upgrade: now looks up the pickaxe by OWNERSHIP
-- (item_instances.owner_id + item_family = 'pickaxe'), not
-- equipped_pickaxe_id, so Tier Up keeps working while unequipped. 'no_pickaxe'
-- now means "never bought one" rather than "not currently equipped" -- same
-- error code, more accurate meaning now that the two can diverge. Otherwise
-- unchanged from 20260928010000.
create or replace function public.pickaxe_tier_upgrade(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owned_pickaxe_id uuid;
  v_current_template_id uuid;
  v_current_name text;
  v_current_required_level integer;
  v_next_template_id uuid;
  v_next_name text;
  v_next_required_level integer;
  v_gems jsonb;
  v_gold integer;
  v_gold_cost integer;
  v_gem_amount integer;
  v_gem_keys text[];
  v_key text;
  v_gem_owned integer;
  v_ascended_gem_type text;
  i integer;
begin
  select account_id, gems, gold, pickaxe_ascended_gem_type
  into v_account_id, v_gems, v_gold, v_ascended_gem_type
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select ii.id, ii.template_id, it.name, it.required_level
  into v_owned_pickaxe_id, v_current_template_id, v_current_name, v_current_required_level
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.owner_id = character_id and it.item_family = 'pickaxe'
  for update of ii
  limit 1;

  if v_owned_pickaxe_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pickaxe');
  end if;

  select id, name, required_level into v_next_template_id, v_next_name, v_next_required_level
  from public.item_templates
  where item_family = 'pickaxe' and required_level > v_current_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_tier', 'template_id', v_current_template_id, 'name', v_current_name);
  end if;

  case v_next_name
    when 'Tempered Pickaxe' then
      v_gem_amount := 5; v_gold_cost := 100000;
      v_gem_keys := array['drake_normal', 'ember_normal', 'bastion_normal', 'iris_normal'];
    when 'Infused Pickaxe' then
      v_gem_amount := 1; v_gold_cost := 250000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'Radiant Pickaxe' then
      v_gem_amount := 5; v_gold_cost := 500000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'Ascended Pickaxe' then
      if v_ascended_gem_type is null then
        v_ascended_gem_type := (array['drake', 'ember', 'bastion', 'iris'])[floor(random() * 4)::int + 1];
        update public.characters set pickaxe_ascended_gem_type = v_ascended_gem_type where id = character_id;
      end if;
      v_gem_amount := 1; v_gold_cost := 0;
      v_gem_keys := array[v_ascended_gem_type || '_ascended'];
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_next_tier');
  end case;

  if v_gold < v_gold_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'gold_cost', v_gold_cost, 'gold', v_gold);
  end if;
  for i in 1..array_length(v_gem_keys, 1) loop
    v_key := v_gem_keys[i];
    v_gem_owned := coalesce((v_gems ->> v_key)::integer, 0);
    if v_gem_owned < v_gem_amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gems', 'gem_key', v_key, 'needed', v_gem_amount, 'owned', v_gem_owned);
    end if;
  end loop;

  for i in 1..array_length(v_gem_keys, 1) loop
    v_key := v_gem_keys[i];
    v_gem_owned := coalesce((v_gems ->> v_key)::integer, 0);
    v_gems := jsonb_set(v_gems, array[v_key], to_jsonb(v_gem_owned - v_gem_amount));
  end loop;

  update public.characters
  set gems = v_gems, gold = gold - v_gold_cost
  where id = character_id
  returning gold into v_gold;

  update public.item_instances
  set template_id = v_next_template_id, level = v_next_required_level
  where id = v_owned_pickaxe_id;

  return jsonb_build_object(
    'ok', true,
    'template_id', v_next_template_id,
    'name', v_next_name,
    'gold_spent', v_gold_cost,
    'gold_remaining', v_gold,
    'gems', v_gems,
    'ascended_gem_type', v_ascended_gem_type
  );
end;
$$;

revoke all on function public.pickaxe_tier_upgrade(uuid) from public;
grant execute on function public.pickaxe_tier_upgrade(uuid) to authenticated;

-- shop_buy_pickaxe: "already own one" check switched from
-- equipped_pickaxe_id to real ownership, so an unequipped owner can't buy a
-- second. Otherwise unchanged from 20260928010000 (still auto-equips the
-- new purchase, since a fresh buyer has nothing equipped to conflict with).
create or replace function public.shop_buy_pickaxe(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_gold integer;
  v_already_owned uuid;
  v_template_id uuid;
  v_price integer;
  v_new_gold integer;
  v_new_item public.item_instances%rowtype;
begin
  select account_id, gold
  into v_account_id, v_gold
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select ii.id into v_already_owned
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.owner_id = character_id and it.item_family = 'pickaxe'
  limit 1;

  if v_already_owned is not null then
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
