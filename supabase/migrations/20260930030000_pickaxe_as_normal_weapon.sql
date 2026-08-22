-- Pickaxe becomes a normal Main Hand weapon (requested by the user) --
-- supersedes the entire bespoke equipped_pickaxe_id/ensure_starter_pickaxe/
-- equip_pickaxe/unequip_pickaxe/shop_buy_pickaxe subsystem. Pickaxe now
-- equips/unequips through the exact same equipped_weapon_id column and
-- standard Equip flow every other weapon uses, buys through the standard
-- shop_buy_item RPC (no more one-per-character limit), and shows a normal
-- gear tooltip. The bespoke gold+gem "Tier Up" progression (pickaxe_tier_upgrade)
-- is kept as-is, per the user, just re-targeted at the equipped weapon
-- instead of "any owned pickaxe" (multiple can now be owned).

-- 1. Pickaxe templates become real weapon-slot items.
update public.item_templates set slot_type = 'weapon' where item_family = 'pickaxe';

-- 2. Drop the entire superseded equip/purchase subsystem.
drop function if exists public.ensure_starter_pickaxe(uuid);
drop function if exists public.equip_pickaxe(uuid);
drop function if exists public.unequip_pickaxe(uuid);
drop function if exists public.shop_buy_pickaxe(uuid);

-- 3. pickaxe_tier_upgrade -- now targets the equipped weapon (must be
-- pickaxe-family), not an arbitrary "any owned pickaxe" row. Cost table,
-- Ascended gem-type roll, and template/level advance logic are otherwise an
-- unchanged copy of the latest body (20260930000000_pickaxe_equip_requirement.sql).
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
  from public.characters c
  join public.item_instances ii on ii.id = c.equipped_weapon_id
  join public.item_templates it on it.id = ii.template_id
  where c.id = character_id and it.item_family = 'pickaxe'
  for update of ii;

  if v_owned_pickaxe_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pickaxe_equipped');
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
    'item_id', v_owned_pickaxe_id,
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

-- 4. resolve_mining_gather_state -- reads the equipped weapon (+ item_family
-- check) instead of the dropped equipped_pickaxe_id/ensure_starter_pickaxe
-- auto-grant; a null/non-pickaxe weapon just yields pickaxe: null, which
-- resolve-mining's Edge Function already handles as its existing 'no_pickaxe'
-- response (no Edge Function redeploy needed). Also fixes the room-check
-- gear_count query to exclude all 7 equip slots (it previously only ever
-- excluded the single old pickaxe pointer), mirroring
-- resolve_combat_gather_state's own v_equipped_ids exclusion.
create or replace function public.resolve_mining_gather_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_old_character jsonb;
  v_old_resolved_at timestamptz;
  v_new_resolved_at timestamptz := now();
  v_selected_mine_id text;
  v_account_id uuid;
  v_equipped_weapon_id uuid;
  v_rows_updated integer;
  v_claimed boolean;
  v_pickaxe jsonb;
  v_node jsonb;
  v_gear_count integer;
  v_holding_count integer;
  v_equipped_ids uuid[];
begin
  select to_jsonb(c), c.mining_last_resolved_at, c.selected_mine_id, c.account_id, c.equipped_weapon_id
  into v_old_character, v_old_resolved_at, v_selected_mine_id, v_account_id, v_equipped_weapon_id
  from public.characters c
  where c.id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.characters
  set mining_last_resolved_at = v_new_resolved_at
  where id = p_character_id and mining_last_resolved_at = v_old_resolved_at;
  get diagnostics v_rows_updated = row_count;
  v_claimed := v_rows_updated > 0;

  if not v_claimed or v_selected_mine_id is null then
    return jsonb_build_object(
      'ok', true,
      'claimed', v_claimed,
      'claimed_at', case when v_claimed then v_new_resolved_at else null end,
      'restore_at', v_old_resolved_at,
      'character', v_old_character,
      'node', null
    );
  end if;

  select jsonb_build_object(
    'id', ii.id,
    'template_id', ii.template_id,
    'composition_level', ii.composition_level,
    'physical_attack', coalesce((it.base_stats->>'physical_attack')::numeric, 0)
  )
  into v_pickaxe
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = v_equipped_weapon_id and it.item_family = 'pickaxe';

  select to_jsonb(n) into v_node from public.mining_nodes n where n.mine_id = v_selected_mine_id;

  if v_node is null then
    return jsonb_build_object(
      'ok', true,
      'claimed', true,
      'claimed_at', v_new_resolved_at,
      'restore_at', v_old_resolved_at,
      'character', v_old_character,
      'pickaxe', v_pickaxe,
      'node', null
    );
  end if;

  -- Room check for Ore drops (Gems bypass this entirely, see header note).
  select array_remove(array[
    (v_old_character->>'equipped_weapon_id')::uuid,
    (v_old_character->>'equipped_ring_id')::uuid,
    (v_old_character->>'equipped_necklace_id')::uuid,
    (v_old_character->>'equipped_boots_id')::uuid,
    (v_old_character->>'equipped_hat_id')::uuid,
    (v_old_character->>'equipped_coat_id')::uuid,
    (v_old_character->>'equipped_quiver_id')::uuid
  ], null) into v_equipped_ids;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select count(*) into v_holding_count from public.loot_holding where character_id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'claimed_at', v_new_resolved_at,
    'restore_at', v_old_resolved_at,
    'character', v_old_character,
    'pickaxe', v_pickaxe,
    'node', v_node,
    'gear_count', v_gear_count,
    'holding_count', v_holding_count
  );
end;
$$;

revoke all on function public.resolve_mining_gather_state(uuid) from public;
grant execute on function public.resolve_mining_gather_state(uuid) to service_role;

-- 5. Drop the now-unused equip pointer. pickaxe_ascended_gem_type is kept --
-- still needed by pickaxe_tier_upgrade's persistent Ascended-tier gem-type
-- memory. Per the user: no data backfill -- any character with a Pickaxe
-- equipped via the old column just has it fall back to a normal owned,
-- unequipped Inventory item once this column (and its client reads) are gone.
alter table public.characters drop column if exists equipped_pickaxe_id;
