-- Enchantress "Bless" (item_instances.enchant.blessPct) and the socketed
-- Bastion gem's damage-reduction % were both confirmed client-only, never
-- mirrored server-side, in every domain doc (CLAUDE.gear-and-forge.md,
-- resolve-pvp-duel/index.ts's own header comment). Reported by the user
-- 2026-09-07 as an unacceptable gap, especially for PvP (a duel's outcome is
-- entirely server-resolved, so a defender's Bless/Bastion investment did
-- nothing there at all). This migration adds `enchant` to both gather
-- queries' equipped-items projection so the Edge Functions can read
-- blessPct; the Edge Function changes (resolve-combat/index.ts,
-- resolve-pvp-duel/index.ts) ship in the same commit.
--
-- resolve-combat already partially had this (Bastion's socket % was folded
-- into damageReductionPct back in the player-survivability-cycle work) --
-- only Bless was the disclosed gap there, because the gather query never
-- selected `enchant` at all. PvP had neither -- both were explicitly
-- excluded from the original confirmed duel design.
begin;

-- ============================================================================
-- 1. resolve_combat_gather_state -- same signature (p_character_id, p_session_id),
--    only the returned equipped_items rows gain an 'enchant' key, so this is
--    a plain create-or-replace. Full body otherwise copied verbatim from
--    20261209020000_mp_potion_auto_use_offline.sql.
-- ============================================================================
create or replace function public.resolve_combat_gather_state(p_character_id uuid, p_session_id text default null)
returns jsonb
language plpgsql
as $$
declare
  v_old_character jsonb;
  v_old_resolved_at timestamptz;
  v_selected_monster_id text;
  v_account_id uuid;
  v_current_session_id text;
  v_rows_updated integer;
  v_claimed boolean;
  v_monster jsonb;
  v_equipped_items jsonb;
  v_equipped_ids_no_quiver uuid[];
  v_equipped_ids_with_quiver uuid[];
  v_equipped_ids_room_check uuid[];
  v_gear_count integer;
  v_potion_count integer;
  v_potion_stacks jsonb;
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

  select current_session_id into v_current_session_id from public.players where id = v_account_id;

  if p_session_id is not null and v_current_session_id is not null and v_current_session_id <> p_session_id then
    return jsonb_build_object(
      'ok', true,
      'claimed', false,
      'session_superseded', true,
      'character', v_old_character,
      'monster', null
    );
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

  v_equipped_ids_room_check := array_remove(
    array_append(v_equipped_ids_with_quiver, (v_old_character->>'equipped_pickaxe_id')::uuid),
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
    'sockets', coalesce(ii.sockets, '[]'::jsonb),
    'enchant', ii.enchant
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids_with_quiver);

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids_room_check))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select count(*) into v_potion_count
  from public.potion_stacks
  where character_id = p_character_id and count > 0;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'potion_type', potion_type, 'count', count)), '[]'::jsonb)
  into v_potion_stacks
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
    'potion_stacks', v_potion_stacks,
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

revoke all on function public.resolve_combat_gather_state(uuid, text) from public;
grant execute on function public.resolve_combat_gather_state(uuid, text) to service_role;

-- ============================================================================
-- 2. pvp_duel_gather_state -- same signature (p_duel_id, p_character_id), only
--    each equipped-items row gains an 'enchant' key. Full body otherwise
--    copied verbatim from 20261128000000_pvp_duel_tournament_hook.sql.
-- ============================================================================
create or replace function public.pvp_duel_gather_state(p_duel_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_duel record;
  v_defender_id uuid;
  v_expected_actor uuid;
  v_winner uuid;
  v_my_zone_x integer;
begin
  select * into v_duel from public.pvp_duels where id = p_duel_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_character_id not in (v_duel.player_a_character_id, v_duel.player_b_character_id) then
    return jsonb_build_object('ok', false, 'error', 'not_participant');
  end if;

  if v_duel.status <> 'active' then
    return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'active', false);
  end if;

  if v_duel.turn_deadline is not null and now() > v_duel.turn_deadline then
    v_winner := case when v_duel.current_turn_character_id = v_duel.player_a_character_id
      then v_duel.player_b_character_id else v_duel.player_a_character_id end;

    update public.pvp_duels
    set status = 'forfeited', turn_deadline = null, updated_at = now(),
        winner_character_id = v_winner
    where id = p_duel_id
    returning * into v_duel;

    perform public.pvp_tournament_record_duel_result(p_duel_id, v_winner);

    return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'active', false, 'forfeited', true);
  end if;

  if p_character_id <> v_duel.current_turn_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_your_turn', 'duel', to_jsonb(v_duel));
  end if;

  v_my_zone_x := case when p_character_id = v_duel.player_a_character_id
    then v_duel.player_a_zone_x else v_duel.player_b_zone_x end;

  return jsonb_build_object(
    'ok', true,
    'active', true,
    'duel', to_jsonb(v_duel),
    'required_action', case when v_my_zone_x is null then 'place_zone' else 'guess' end,
    'player_a_character', (select to_jsonb(c) from public.characters c where c.id = v_duel.player_a_character_id),
    'player_a_equipped_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quality_tier', ii.quality_tier, 'composition_level', ii.composition_level,
        'durability', ii.durability, 'base_stats', it.base_stats, 'slot_type', it.slot_type,
        'sockets', coalesce(ii.sockets, '[]'::jsonb), 'enchant', ii.enchant
      )), '[]'::jsonb)
      from public.characters c
      join public.item_instances ii on ii.id = any(array_remove(array[
        c.equipped_weapon_id, c.equipped_ring_id, c.equipped_necklace_id,
        c.equipped_boots_id, c.equipped_hat_id, c.equipped_coat_id
      ], null))
      join public.item_templates it on it.id = ii.template_id
      where c.id = v_duel.player_a_character_id
    ),
    'player_b_character', (select to_jsonb(c) from public.characters c where c.id = v_duel.player_b_character_id),
    'player_b_equipped_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quality_tier', ii.quality_tier, 'composition_level', ii.composition_level,
        'durability', ii.durability, 'base_stats', it.base_stats, 'slot_type', it.slot_type,
        'sockets', coalesce(ii.sockets, '[]'::jsonb), 'enchant', ii.enchant
      )), '[]'::jsonb)
      from public.characters c
      join public.item_instances ii on ii.id = any(array_remove(array[
        c.equipped_weapon_id, c.equipped_ring_id, c.equipped_necklace_id,
        c.equipped_boots_id, c.equipped_hat_id, c.equipped_coat_id
      ], null))
      join public.item_templates it on it.id = ii.template_id
      where c.id = v_duel.player_b_character_id
    )
  );
end;
$$;

revoke all on function public.pvp_duel_gather_state(uuid, uuid) from public;
grant execute on function public.pvp_duel_gather_state(uuid, uuid) to service_role;

commit;
