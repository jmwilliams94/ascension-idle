-- Second-hand slot repurposing (2026-08-18, prep for Twin-soul/Wuxia/
-- Juggernaut): `equipped_quiver_id`/`slot_type: 'quiver'` used to always be
-- Hunter's stat-less ammo Quiver, so both server-side "gather equipped gear
-- for combat stats" functions deliberately excluded it from the stat query
-- entirely (harmless, since it never had any base_stats to contribute).
-- Now that the same slot also holds Twin-soul's real off-hand weapon
-- (physical_attack) and Juggernaut's real Shield, that exclusion would
-- silently drop their second-hand stat contribution from server-authoritative
-- combat once those classes exist — client-side computeEquipmentBonus
-- already includes every EQUIP_SLOTS entry generically (equipmentBonus.ts),
-- so this was a client/server desync waiting to happen. Fixed by including
-- the quiver-slot item in both functions' stat-gathering query. Hunter's own
-- Quiver is unaffected (its base_stats is still `{}`, so including it adds
-- zero to every stat, same as today).
--
-- Both functions below are full-body copies of their current latest
-- definition (verified via `create or replace function` grep across every
-- migration, same convention as 20260901060000_room_check_excludes_listed_
-- and_mailed.sql) — only the one line noted inline changed in each. No
-- signature changes, so plain create-or-replace is safe.
begin;

-- ============================================================================
-- 1. resolve_combat_gather_state -- full body from
--    20260901060000_room_check_excludes_listed_and_mailed.sql. Only change:
--    the equipped_items stat query now reads v_equipped_ids_with_quiver
--    instead of v_equipped_ids_no_quiver (v_equipped_ids_with_quiver already
--    existed for the separate v_gear_count/room-check query below it).
-- ============================================================================
create or replace function public.resolve_combat_gather_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_old_character jsonb;
  v_old_resolved_at timestamptz;
  v_selected_monster_id text;
  v_account_id uuid;
  v_rows_updated integer;
  v_claimed boolean;
  v_monster jsonb;
  v_equipped_items jsonb;
  v_equipped_ids_no_quiver uuid[];
  v_equipped_ids_with_quiver uuid[];
  v_gear_count integer;
  v_potion_count integer;
  v_holding_count integer;
  v_character_kills jsonb;
  v_account_kills jsonb;
  v_best_claimed_tier integer;
  v_pet_exists boolean;
  v_player jsonb;
  v_active_event jsonb;
begin
  select to_jsonb(c), c.combat_last_resolved_at, c.selected_monster_id, c.account_id
  into v_old_character, v_old_resolved_at, v_selected_monster_id, v_account_id
  from public.characters c
  where c.id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.characters
  set combat_last_resolved_at = now()
  where id = p_character_id and combat_last_resolved_at = v_old_resolved_at;
  get diagnostics v_rows_updated = row_count;
  v_claimed := v_rows_updated > 0;

  if not v_claimed or v_selected_monster_id is null then
    return jsonb_build_object(
      'ok', true,
      'claimed', v_claimed,
      'character', v_old_character,
      'monster', null
    );
  end if;

  select to_jsonb(e) into v_monster from public.enemy_types e where e.id = v_selected_monster_id;

  if v_monster is null then
    return jsonb_build_object('ok', true, 'claimed', true, 'character', v_old_character, 'monster', null);
  end if;

  v_equipped_ids_no_quiver := array_remove(array[
    (v_old_character->>'equipped_weapon_id')::uuid,
    (v_old_character->>'equipped_ring_id')::uuid,
    (v_old_character->>'equipped_necklace_id')::uuid,
    (v_old_character->>'equipped_boots_id')::uuid,
    (v_old_character->>'equipped_hat_id')::uuid,
    (v_old_character->>'equipped_coat_id')::uuid
  ], null);

  v_equipped_ids_with_quiver := array_remove(
    array_append(v_equipped_ids_no_quiver, (v_old_character->>'equipped_quiver_id')::uuid),
    null
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ii.id,
    'quality_tier', ii.quality_tier,
    'template_id', ii.template_id,
    'composition_level', ii.composition_level,
    'durability', ii.durability,
    'base_stats', it.base_stats,
    'slot_type', it.slot_type,
    'required_level', it.required_level,
    'sockets', coalesce(ii.sockets, '[]'::jsonb)
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids_with_quiver);

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids_with_quiver))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select count(*) into v_potion_count
  from public.potion_stacks
  where character_id = p_character_id and count > 0;

  select count(*) into v_holding_count
  from public.loot_holding
  where character_id = p_character_id;

  select to_jsonb(k) into v_character_kills
  from public.character_monster_kills k
  where k.character_id = p_character_id and k.monster_id = v_selected_monster_id;

  select to_jsonb(a) into v_account_kills
  from public.account_monster_kills a
  where a.account_id = v_account_id and a.monster_id = v_selected_monster_id;

  select coalesce(max(claimed_tier_index), 0) into v_best_claimed_tier
  from public.account_monster_kills
  where account_id = v_account_id;

  select exists(
    select 1 from public.account_pets
    where account_id = v_account_id and monster_id = v_selected_monster_id
  ) into v_pet_exists;

  select to_jsonb(p) into v_player from public.players p where p.id = v_account_id;

  select jsonb_build_object('category', gp.buff_category, 'multiplier', gp.buff_multiplier)
  into v_active_event
  from public.gold_donation_state gs
  join public.gold_donation_pools gp on gp.id = gs.current_pool_id
  where gs.id = 1 and gp.status = 'active' and now() < gp.buff_ends_at;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'character', v_old_character,
    'monster', v_monster,
    'equipped_items', v_equipped_items,
    'gear_count', v_gear_count,
    'potion_count', v_potion_count,
    'holding_count', v_holding_count,
    'character_kills', v_character_kills,
    'account_kills', v_account_kills,
    'best_claimed_tier', v_best_claimed_tier,
    'pet_exists', v_pet_exists,
    'player', v_player,
    'active_event', v_active_event
  );
end;
$$;

revoke all on function public.resolve_combat_gather_state(uuid) from public;
grant execute on function public.resolve_combat_gather_state(uuid) to service_role;

-- ============================================================================
-- 2. world_boss_gather_attack_state -- full body from
--    20260826030000_gather_sockets_for_gem_bonuses.sql. Only change:
--    equipped_quiver_id is now included in v_equipped_ids.
-- ============================================================================
create or replace function public.world_boss_gather_attack_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_character jsonb;
  v_account_id uuid;
  v_equipped_ids uuid[];
  v_equipped_items jsonb;
  v_current_spawn_id uuid;
  v_spawn jsonb;
  v_participant jsonb;
  v_ascension_points integer;
begin
  select to_jsonb(c), c.account_id into v_character, v_account_id
  from public.characters c where c.id = p_character_id;

  if v_character is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_equipped_ids := array_remove(array[
    (v_character->>'equipped_weapon_id')::uuid,
    (v_character->>'equipped_ring_id')::uuid,
    (v_character->>'equipped_necklace_id')::uuid,
    (v_character->>'equipped_boots_id')::uuid,
    (v_character->>'equipped_hat_id')::uuid,
    (v_character->>'equipped_coat_id')::uuid,
    (v_character->>'equipped_quiver_id')::uuid
  ], null);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ii.id,
    'quality_tier', ii.quality_tier,
    'template_id', ii.template_id,
    'composition_level', ii.composition_level,
    'durability', ii.durability,
    'base_stats', it.base_stats,
    'slot_type', it.slot_type,
    'required_level', it.required_level,
    'sockets', coalesce(ii.sockets, '[]'::jsonb)
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids);

  select current_spawn_id into v_current_spawn_id from public.world_boss_state where id = 1;
  select to_jsonb(s) into v_spawn from public.world_boss_spawns s where s.id = v_current_spawn_id;

  select to_jsonb(p) into v_participant
  from public.world_boss_participants p
  where p.spawn_id = v_current_spawn_id and p.character_id = p_character_id;

  select ascension_points into v_ascension_points from public.players where id = v_account_id;

  return jsonb_build_object(
    'ok', true,
    'character', v_character,
    'equipped_items', v_equipped_items,
    'spawn', v_spawn,
    'participant', v_participant,
    'ascension_points', v_ascension_points
  );
end;
$$;

revoke all on function public.world_boss_gather_attack_state(uuid) from public;
grant execute on function public.world_boss_gather_attack_state(uuid) to service_role;

commit;
