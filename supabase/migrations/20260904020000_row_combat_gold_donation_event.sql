-- Row Combat was missing the Gold Donation Event buff entirely (reported by
-- the user, 2026-08-17) — resolve_row_combat_gather_state never fetched
-- gold_donation_state/gold_donation_pools at all, so a live event buff
-- (EXP/quality-tier/Comet/Fallen Star category, see CLAUDE.server-events.md)
-- boosted single-target kills via resolve-combat but had zero effect on
-- Multi-Shot kills. Same query resolve_combat_gather_state already uses,
-- added here so both share the exact same "is a buff currently active"
-- read. Achievement zone attack/drop bonuses were already wired correctly
-- (account_zone_attack_bonus_pct/account_zone_drop_bonus_pct, unchanged).
begin;

create or replace function public.resolve_row_combat_gather_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_old_character jsonb;
  v_old_resolved_at timestamptz;
  v_new_resolved_at timestamptz := now();
  v_account_id uuid;
  v_selected_monster_id text;
  v_row_slots jsonb;
  v_rows_updated integer;
  v_claimed boolean;
  v_monster_ids text[];
  v_enemy_types jsonb;
  v_equipped_items jsonb;
  v_equipped_ids_no_quiver uuid[];
  v_gear_count integer;
  v_potion_count integer;
  v_character_kills jsonb;
  v_pet_monster_ids text[];
  v_player jsonb;
  v_active_event jsonb;
begin
  select to_jsonb(c), c.row_combat_last_resolved_at, c.account_id, c.selected_monster_id, c.row_slots
  into v_old_character, v_old_resolved_at, v_account_id, v_selected_monster_id, v_row_slots
  from public.characters c
  where c.id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.characters
  set row_combat_last_resolved_at = v_new_resolved_at
  where id = p_character_id and row_combat_last_resolved_at = v_old_resolved_at;
  get diagnostics v_rows_updated = row_count;
  v_claimed := v_rows_updated > 0;

  if not v_claimed then
    return jsonb_build_object('ok', true, 'claimed', false, 'character', v_old_character);
  end if;

  -- Distinct monster ids currently occupying any slot (enabled or not —
  -- a just-disabled slot's monster_id is cleared to null by toggle_row_slot,
  -- so this only ever reflects live/pending slots).
  select coalesce(array_agg(distinct value ->> 'monster_id'), array[]::text[])
  into v_monster_ids
  from jsonb_array_elements(coalesce(v_row_slots, '[]'::jsonb)) as value
  where value ->> 'monster_id' is not null;

  select coalesce(jsonb_object_agg(e.id, to_jsonb(e)), '{}'::jsonb)
  into v_enemy_types
  from public.enemy_types e
  where e.id = any(v_monster_ids);

  v_equipped_ids_no_quiver := array_remove(array[
    (v_old_character->>'equipped_weapon_id')::uuid,
    (v_old_character->>'equipped_ring_id')::uuid,
    (v_old_character->>'equipped_necklace_id')::uuid,
    (v_old_character->>'equipped_boots_id')::uuid,
    (v_old_character->>'equipped_hat_id')::uuid,
    (v_old_character->>'equipped_coat_id')::uuid
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
    'sockets', ii.sockets
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids_no_quiver);

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(array_append(v_equipped_ids_no_quiver, (v_old_character->>'equipped_quiver_id')::uuid)));

  select count(*) into v_potion_count
  from public.potion_stacks
  where character_id = p_character_id and count > 0;

  select coalesce(jsonb_object_agg(k.monster_id, to_jsonb(k)), '{}'::jsonb)
  into v_character_kills
  from public.character_monster_kills k
  where k.character_id = p_character_id and k.monster_id = any(v_monster_ids);

  select coalesce(array_agg(monster_id), array[]::text[])
  into v_pet_monster_ids
  from public.account_pets
  where account_id = v_account_id and monster_id = any(v_monster_ids);

  select to_jsonb(p) into v_player from public.players p where p.id = v_account_id;

  -- Gold Donation Event's active buff, if any — same query
  -- resolve_combat_gather_state already uses, see this migration's header.
  select jsonb_build_object('category', gp.buff_category, 'multiplier', gp.buff_multiplier)
  into v_active_event
  from public.gold_donation_state gs
  join public.gold_donation_pools gp on gp.id = gs.current_pool_id
  where gs.id = 1 and gp.status = 'active' and now() < gp.buff_ends_at;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'claimed_at', v_new_resolved_at,
    'restore_at', v_old_resolved_at,
    'character', v_old_character,
    'row_slots', coalesce(v_row_slots, '[]'::jsonb),
    'enemy_types', v_enemy_types,
    'equipped_items', v_equipped_items,
    'gear_count', v_gear_count,
    'potion_count', v_potion_count,
    'character_kills', v_character_kills,
    'pet_monster_ids', v_pet_monster_ids,
    'player', v_player,
    'active_event', v_active_event
  );
end;
$$;

revoke all on function public.resolve_row_combat_gather_state(uuid) from public;
grant execute on function public.resolve_row_combat_gather_state(uuid) to service_role;

commit;
