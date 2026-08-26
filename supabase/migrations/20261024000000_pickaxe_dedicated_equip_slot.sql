-- Pickaxe gets its own equip slot again, independent of the weapon slot
-- (requested by the user) -- partial reversion of
-- 20260930030000_pickaxe_as_normal_weapon.sql. Now that only one character
-- per account can hold the Hunting slot at a time (20261023000000) while
-- every other character just mines, forcing the Pickaxe into
-- equipped_weapon_id was actively counter-productive: a dedicated miner
-- couldn't wear a real weapon at all. A character can now equip a real
-- weapon AND a Pickaxe simultaneously.
--
-- Deliberately NOT a full reversion: item_templates.slot_type stays
-- 'weapon' (unlike the pre-09-30 'pickaxe' slot_type) so Shop/Marketplace/
-- Bank/Sell/Salvage/tooltip/icon code needs zero changes -- only the equip
-- destination changes, gated on item_family = 'pickaxe' (the same
-- discriminator ForgeSocketsTab/composition already use). See
-- CLAUDE.combat-and-loot.md's Mining section for the full writeup.
begin;

alter table public.characters
  add column if not exists equipped_pickaxe_id uuid references public.item_instances (id) on delete set null;

-- Equip -- takes an explicit item_id (unlike the old pre-09-30 version,
-- which just grabbed "any owned pickaxe" -- multiple can now be owned/
-- tiered independently since 09-30, so the player must choose which one).
create or replace function public.equip_pickaxe(character_id uuid, item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owner_id uuid;
  v_item_family text;
begin
  select account_id into v_account_id from public.characters where id = character_id for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select ii.owner_id, it.item_family into v_owner_id, v_item_family
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = item_id;

  if v_owner_id is null or v_owner_id <> character_id then
    return jsonb_build_object('ok', false, 'error', 'item_not_owned');
  end if;
  if v_item_family <> 'pickaxe' then
    return jsonb_build_object('ok', false, 'error', 'not_a_pickaxe');
  end if;

  update public.characters set equipped_pickaxe_id = item_id where id = character_id;

  return jsonb_build_object('ok', true, 'item_id', item_id);
end;
$$;

revoke all on function public.equip_pickaxe(uuid, uuid) from public;
grant execute on function public.equip_pickaxe(uuid, uuid) to authenticated;

-- Unequip -- guaranteed-success, idempotent (mirrors the pre-09-30 version).
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

-- pickaxe_tier_upgrade -- retargeted from equipped_weapon_id back to
-- equipped_pickaxe_id. Cost table / Ascended gem-type roll logic is an
-- otherwise unchanged copy of the latest body (20260930060000).
create or replace function public.pickaxe_tier_upgrade(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owned_pickaxe_id uuid;
  v_current_tier text;
  v_next_tier text;
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

  select ii.id, ii.quality_tier
  into v_owned_pickaxe_id, v_current_tier
  from public.characters c
  join public.item_instances ii on ii.id = c.equipped_pickaxe_id
  join public.item_templates it on it.id = ii.template_id
  where c.id = character_id and it.item_family = 'pickaxe'
  for update of ii;

  if v_owned_pickaxe_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pickaxe_equipped');
  end if;

  v_next_tier := case v_current_tier
    when 'normal' then 'tempered'
    when 'tempered' then 'infused'
    when 'infused' then 'radiant'
    when 'radiant' then 'ascended'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_tier', 'quality_tier', v_current_tier);
  end if;

  case v_next_tier
    when 'tempered' then
      v_gem_amount := 5; v_gold_cost := 100000;
      v_gem_keys := array['drake_normal', 'ember_normal', 'bastion_normal', 'iris_normal'];
    when 'infused' then
      v_gem_amount := 1; v_gold_cost := 250000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'radiant' then
      v_gem_amount := 5; v_gold_cost := 500000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'ascended' then
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
  set quality_tier = v_next_tier
  where id = v_owned_pickaxe_id;

  return jsonb_build_object(
    'ok', true,
    'item_id', v_owned_pickaxe_id,
    'quality_tier', v_next_tier,
    'gold_spent', v_gold_cost,
    'gold_remaining', v_gold,
    'gems', v_gems,
    'ascended_gem_type', v_ascended_gem_type
  );
end;
$$;

revoke all on function public.pickaxe_tier_upgrade(uuid) from public;
grant execute on function public.pickaxe_tier_upgrade(uuid) to authenticated;

-- resolve_mining_gather_state -- pickaxe snapshot now reads
-- equipped_pickaxe_id instead of equipped_weapon_id; gear_count's own
-- equipped-ids exclusion array grows from 7 to 8 to include it (otherwise an
-- equipped Pickaxe counts as a phantom occupied Inventory slot while
-- mining -- same bug class as the fixed 20260930080000 migration).
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
  v_equipped_pickaxe_id uuid;
  v_rows_updated integer;
  v_claimed boolean;
  v_pickaxe jsonb;
  v_node jsonb;
  v_gear_count integer;
  v_holding_count integer;
  v_equipped_ids uuid[];
begin
  select to_jsonb(c), c.mining_last_resolved_at, c.selected_mine_id, c.account_id, c.equipped_pickaxe_id
  into v_old_character, v_old_resolved_at, v_selected_mine_id, v_account_id, v_equipped_pickaxe_id
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
    'quality_tier', ii.quality_tier,
    'composition_level', ii.composition_level,
    'physical_attack', coalesce((it.base_stats->>'physical_attack')::numeric, 0)
  )
  into v_pickaxe
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = v_equipped_pickaxe_id and it.item_family = 'pickaxe';

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

  select array_remove(array[
    (v_old_character->>'equipped_weapon_id')::uuid,
    (v_old_character->>'equipped_ring_id')::uuid,
    (v_old_character->>'equipped_necklace_id')::uuid,
    (v_old_character->>'equipped_boots_id')::uuid,
    (v_old_character->>'equipped_hat_id')::uuid,
    (v_old_character->>'equipped_coat_id')::uuid,
    (v_old_character->>'equipped_quiver_id')::uuid,
    (v_old_character->>'equipped_pickaxe_id')::uuid
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

-- occupied_inventory_slots -- same fix, exclusion array grows 7 -> 8. Other
-- room-check-shaped functions across the codebase duplicate this same array
-- independently and are not swept here -- pre-existing, disclosed
-- duplication (see CLAUDE.md), not newly introduced by this migration.
create or replace function public.occupied_inventory_slots(p_character_id uuid)
returns integer
language plpgsql
as $$
declare
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_equipped_ids uuid[];
begin
  select composition_stones, gems, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_composition_stones, v_gems, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_equipped_ids
  from public.characters
  where id = p_character_id;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

  select coalesce(sum((value)::integer), 0) into v_gem_count
  from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

  select count(*) into v_potion_count
  from public.potion_stacks where character_id = p_character_id and count > 0;

  return v_gear_count + v_stone_count + v_gem_count + v_potion_count
    + coalesce(v_comet_count, 0) + coalesce(v_fallen_star_count, 0)
    + coalesce(v_comet_scroll_count, 0) + coalesce(v_fallen_star_scroll_count, 0);
end;
$$;

revoke all on function public.occupied_inventory_slots(uuid) from public;

commit;
