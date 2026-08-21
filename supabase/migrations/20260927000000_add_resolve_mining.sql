-- Mining mechanic, step 2 of 3 — server-authoritative resolver, mirroring
-- resolve-combat's architecture (gather -> compute -> apply, CAS-claimed
-- resolve window) but simplified: no EXP, no dodge/hit-chance, no node
-- attack-back, no player HP risk, no gear durability. A mining node is
-- inanimate — resolvePhysicalDamage(attack, defense) is the only formula
-- needed, applied via a Deno sibling Edge Function (resolve-mining) that
-- re-derives the equipped Pickaxe's attack midpoint server-side (template
-- physical_attack + composition bonus only — no class attributes, no other
-- equipped gear, unlike combat).
--
-- Gems dropped by mining are applied as a direct characters.gems delta,
-- live or offline alike — unlike gear/Ore, gems are an uncapped fungible
-- counter with no Inventory-slot concept at the storage layer (only a
-- rendering-time tile allocation), so there's no "can't fit" case that would
-- need Loot Holding's overflow routing. Ore (real item_instances rows, finite
-- slots) reuses the exact live-grants-directly / offline-routes-to-
-- loot_holding split gear drops already use in resolve_combat_apply_results.
begin;

-- Shared by pickaxe_tier_upgrade (Step 1) and resolve_mining_gather_state
-- (below) so a character can start mining immediately without visiting the
-- Pickaxe panel first. Re-declared here as security definer + granted to
-- both authenticated (called from pickaxe_tier_upgrade) and service_role
-- (called from resolve_mining_gather_state, itself invoked by the Edge
-- Function's service-role client — SECURITY DEFINER only changes whose
-- privileges apply *inside* the function body, the caller still needs its
-- own EXECUTE grant, see CLAUDE.md's world-boss-attack precedent).
create or replace function public.ensure_starter_pickaxe(p_character_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equipped_pickaxe_id uuid;
  v_base_template_id uuid;
begin
  select equipped_pickaxe_id into v_equipped_pickaxe_id from public.characters where id = p_character_id for update;

  if v_equipped_pickaxe_id is not null then
    return v_equipped_pickaxe_id;
  end if;

  select id into v_base_template_id from public.item_templates
  where item_family = 'pickaxe' order by required_level asc limit 1;

  insert into public.item_instances (template_id, owner_id, quality_tier, level, location)
  values (v_base_template_id, p_character_id, 'normal', 1, 'inventory')
  returning id into v_equipped_pickaxe_id;

  update public.characters set equipped_pickaxe_id = v_equipped_pickaxe_id where id = p_character_id;

  return v_equipped_pickaxe_id;
end;
$$;

revoke all on function public.ensure_starter_pickaxe(uuid) from public;
grant execute on function public.ensure_starter_pickaxe(uuid) to authenticated, service_role;

-- pickaxe_tier_upgrade now calls the shared helper above instead of its own
-- inline copy of the same lazy-grant logic — same signature, safe
-- create-or-replace, body otherwise unchanged from 20260926000000.
create or replace function public.pickaxe_tier_upgrade(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_equipped_pickaxe_id uuid;
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
  select account_id, equipped_pickaxe_id, gems, gold, pickaxe_ascended_gem_type
  into v_account_id, v_equipped_pickaxe_id, v_gems, v_gold, v_ascended_gem_type
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_equipped_pickaxe_id is null then
    v_equipped_pickaxe_id := public.ensure_starter_pickaxe(character_id);
  end if;

  select ii.template_id, it.name, it.required_level
  into v_current_template_id, v_current_name, v_current_required_level
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = v_equipped_pickaxe_id
  for update of ii;

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
  where id = v_equipped_pickaxe_id;

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

-- Client autosave needs to write selected_mine_id/last_active_idle_mode the
-- same way it already writes selected_monster_id/current_zone (see
-- 20260821000000_lock_down_direct_table_writes.sql's column-level grant).
-- equipped_pickaxe_id deliberately NOT added here — there's only ever one
-- Pickaxe per character and it's never swapped by the player, only advanced
-- in place server-side (ensure_starter_pickaxe/pickaxe_tier_upgrade), so
-- there's no legitimate client-driven "equip a different pickaxe" action.
grant update (selected_mine_id, last_active_idle_mode) on public.characters to authenticated;

-- ============================================================================
-- 1. resolve_mining_gather_state -- CAS-claims mining_last_resolved_at, mirrors
--    resolve_combat_gather_state's claim/restore shape exactly.
-- ============================================================================
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

  if v_equipped_pickaxe_id is null then
    v_equipped_pickaxe_id := public.ensure_starter_pickaxe(p_character_id);
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
  where ii.id = v_equipped_pickaxe_id;

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
  -- Approximates the same "unequipped item_instances not banked/listed/
  -- mailed" scope resolve_combat_gather_state's own gear_count uses.
  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and id <> v_equipped_pickaxe_id
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

-- ============================================================================
-- 2. resolve_mining_apply_results -- atomic write. p_gem_drops always applies
--    as a direct characters.gems delta (live or offline). p_ore_drops: live
--    mode grants straight into item_instances, offline mode routes to
--    loot_holding -- identical branching to resolve_combat_apply_results'
--    own p_item_drops loop.
-- ============================================================================
create or replace function public.resolve_mining_apply_results(
  p_character_id uuid,
  p_mode text,
  p_gem_drops jsonb default '[]'::jsonb,
  p_ore_drops jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_gem jsonb;
  v_ore jsonb;
  v_gems jsonb;
  v_key text;
  v_amount integer;
  v_owned integer;
  v_granted_items jsonb := '[]'::jsonb;
  v_new_item public.item_instances%rowtype;
begin
  select coalesce(gems, '{}'::jsonb) into v_gems from public.characters where id = p_character_id for update;

  for v_gem in select * from jsonb_array_elements(p_gem_drops)
  loop
    v_key := v_gem ->> 'gem_key';
    v_amount := (v_gem ->> 'amount')::integer;
    v_owned := coalesce((v_gems ->> v_key)::integer, 0);
    v_gems := jsonb_set(v_gems, array[v_key], to_jsonb(v_owned + v_amount));
  end loop;

  update public.characters set gems = v_gems where id = p_character_id;

  for v_ore in select * from jsonb_array_elements(p_ore_drops)
  loop
    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, location)
      values ((v_ore ->> 'template_id')::uuid, p_character_id, 1, 'normal', 0, 'inventory')
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level)
      values (p_character_id, (v_ore ->> 'template_id')::uuid, 'normal', 0);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'gems', v_gems, 'granted_items', v_granted_items);
end;
$$;

revoke all on function public.resolve_mining_apply_results(uuid, text, jsonb, jsonb) from public;
grant execute on function public.resolve_mining_apply_results(uuid, text, jsonb, jsonb) to service_role;

-- ============================================================================
-- 3. resolve_mining_release_claim -- compensating rollback, identical shape
--    to resolve_combat_release_claim.
-- ============================================================================
create or replace function public.resolve_mining_release_claim(
  p_character_id uuid,
  p_claimed_at timestamptz,
  p_restore_to timestamptz
)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.characters
  set mining_last_resolved_at = p_restore_to
  where id = p_character_id and mining_last_resolved_at = p_claimed_at;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.resolve_mining_release_claim(uuid, timestamptz, timestamptz) from public;
grant execute on function public.resolve_mining_release_claim(uuid, timestamptz, timestamptz) to service_role;

commit;
