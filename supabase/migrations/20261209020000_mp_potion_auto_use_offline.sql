-- Server-side half of VIP auto-potion (2026-09-02, see
-- src/game/vip/useVipAutomationStore.ts's autoUsePotions setting and
-- src/game/items/PotionAutoUseEngine.tsx's own header comment for why HP
-- isn't included here: resolve-combat's offline/AFK model only tracks
-- current_mp as a real persisted number — player HP is a statistical
-- "timeToPlayerDeathMs" expected-value estimate, not a continuous value, so
-- there's no representable "below 30%" moment for HP to hook into without a
-- much larger rework of walkCombat's own survivability math. MP auto-potion
-- is fully offline-capable: resolve-combat now tops current_mp up from the
-- character's own potion_stacks (best owned tier first, same "best
-- available" convention as a manual Use) whenever the call's own MP budget
-- would otherwise dip the pool below 30% of max before the elapsed window is
-- covered, gated on vip_expires_at + characters.vip_automation_settings ->
-- 'autoUsePotions' -> 'mp' (both already present on the full character row
-- resolve_combat_gather_state returns via to_jsonb(c) — no new column
-- needed for either).
begin;

-- ============================================================================
-- 1. resolve_combat_gather_state -- same signature (p_character_id, p_session_id),
--    only the returned jsonb gains a 'potion_stacks' key, so this is a plain
--    create-or-replace (no drop needed, unlike #2 below). Full body otherwise
--    copied verbatim from 20261119000000_resolve_combat_session_fencing.sql.
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
    and not (id = any(v_equipped_ids_room_check))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select count(*) into v_potion_count
  from public.potion_stacks
  where character_id = p_character_id and count > 0;

  -- New (2026-09-02) -- real per-stack rows so the MP auto-potion pass below
  -- can pick a best-tier-first stack to drink from, mirroring the client's
  -- own findBestPotionStack (potionSelectors.ts) convention. Both kinds are
  -- returned (not just MP) for future reuse; only MP is ever consumed by
  -- this function today.
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
-- 2. resolve_combat_apply_results -- new p_mp_potions_consumed param (signature
--    change -- explicit drop first, see CLAUDE.md's own gotcha). Full body
--    otherwise copied verbatim from 20261205000000_mp_max_clamp_and_null_init_fix.sql.
-- ============================================================================
drop function if exists public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb, numeric
);

create or replace function public.resolve_combat_apply_results(
  p_character_id uuid,
  p_account_id uuid,
  p_monster_id text,
  p_mode text,
  p_kills_delta numeric,
  p_gold_delta integer,
  p_exp integer,
  p_level integer,
  p_comet_delta integer,
  p_fallen_star_delta integer,
  p_comet_scroll_delta integer default 0,
  p_durability_updates jsonb default '[]'::jsonb,
  p_pet_obtained boolean default false,
  p_item_drops jsonb default '[]'::jsonb,
  p_currency_drops jsonb default '[]'::jsonb,
  p_mp_spent numeric default null,
  p_monster_instance_state jsonb default null,
  p_max_mp numeric default null,
  p_mp_potions_consumed jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_character_kills numeric;
  v_account_kills numeric;
  v_gold integer;
  v_comets integer;
  v_fallen_stars integer;
  v_comet_scrolls integer;
  v_current_mp numeric;
  v_drop jsonb;
  v_currency jsonb;
  v_potion jsonb;
  v_granted_items jsonb := '[]'::jsonb;
  v_new_item public.item_instances%rowtype;
  v_character_name text;
  v_monster_name text;
  v_max_durability numeric;
  v_rolled_durability numeric;
begin
  if p_kills_delta > 0 then
    insert into public.character_monster_kills (character_id, monster_id, kills)
    values (p_character_id, p_monster_id, p_kills_delta)
    on conflict (character_id, monster_id)
    do update set kills = public.character_monster_kills.kills + excluded.kills
    returning kills into v_character_kills;

    insert into public.account_monster_kills (account_id, monster_id, kills)
    values (p_account_id, p_monster_id, p_kills_delta)
    on conflict (account_id, monster_id)
    do update set kills = public.account_monster_kills.kills + excluded.kills
    returning kills into v_account_kills;
  end if;

  if p_pet_obtained then
    insert into public.account_pets (account_id, monster_id)
    values (p_account_id, p_monster_id)
    on conflict do nothing;

    if found then
      select name into v_character_name from public.characters where id = p_character_id;
      select display_name into v_monster_name from public.enemy_types where id = p_monster_id;

      insert into public.global_announcements (kind, character_name, message)
      values (
        'pet_obtained',
        v_character_name,
        v_character_name || ' obtained the ' || coalesce(v_monster_name, 'Unknown') || ' pet!'
      );
    end if;
  end if;

  if jsonb_array_length(p_durability_updates) > 0 then
    update public.item_instances ii
    set durability = (u ->> 'durability')::numeric
    from jsonb_array_elements(p_durability_updates) as u
    where ii.id = (u ->> 'id')::uuid and ii.owner_id = p_character_id;
  end if;

  -- MP auto-potion consumption (2026-09-02, see this migration's own header)
  -- -- decrements whichever stacks resolve-combat's own pre-walk top-up
  -- loop drank from. A concurrent manual Use landing on the same stack
  -- between that read and this write can only ever make count lower than
  -- expected, never negative or wrong-positive (greatest(0, ...) floors it),
  -- same defensive shape as everything else this function writes.
  if jsonb_array_length(p_mp_potions_consumed) > 0 then
    for v_potion in select * from jsonb_array_elements(p_mp_potions_consumed)
    loop
      update public.potion_stacks
      set count = greatest(0, count - (v_potion ->> 'count')::integer)
      where id = (v_potion ->> 'stack_id')::uuid and character_id = p_character_id;
    end loop;
  end if;

  for v_drop in select * from jsonb_array_elements(p_item_drops)
  loop
    v_max_durability := coalesce((v_drop ->> 'max_durability')::numeric, 0);
    v_rolled_durability := case
      when v_max_durability > 0 then (1 + floor(random() * v_max_durability))
      else 0
    end;

    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, durability)
      values (
        (v_drop ->> 'template_id')::uuid,
        p_character_id,
        (v_drop ->> 'required_level')::integer,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        v_rolled_durability
      )
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level, durability)
      values (
        p_character_id,
        (v_drop ->> 'template_id')::uuid,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        v_rolled_durability
      );
    end if;
  end loop;

  for v_currency in select * from jsonb_array_elements(p_currency_drops)
  loop
    insert into public.loot_holding (character_id, currency_type)
    values (p_character_id, v_currency ->> 'currency_type');
  end loop;

  update public.characters
  set
    gold = gold + p_gold_delta,
    exp = p_exp,
    level = p_level,
    comet_count = comet_count + p_comet_delta,
    fallen_star_count = fallen_star_count + p_fallen_star_delta,
    comet_scroll_count = comet_scroll_count + p_comet_scroll_delta,
    current_mp = case
      when p_mp_spent is null then current_mp
      else least(greatest(0, coalesce(current_mp, p_max_mp) - p_mp_spent), p_max_mp)
    end,
    current_monster_id = case when p_monster_instance_state is null then current_monster_id
                              else p_monster_instance_state ->> 'monster_id' end,
    current_monster_hp = case when p_monster_instance_state is null then current_monster_hp
                              else (p_monster_instance_state ->> 'hp')::numeric end,
    current_monster_is_rare = case when p_monster_instance_state is null then current_monster_is_rare
                              else (p_monster_instance_state ->> 'is_rare')::boolean end,
    current_monster_spawned_at = case when p_monster_instance_state is null then current_monster_spawned_at
                              else (p_monster_instance_state ->> 'spawned_at')::timestamptz end,
    current_monster_respawn_at = case when p_monster_instance_state is null then current_monster_respawn_at
                              else (p_monster_instance_state ->> 'respawn_at')::timestamptz end
  where id = p_character_id
  returning gold, comet_count, fallen_star_count, comet_scroll_count, current_mp
  into v_gold, v_comets, v_fallen_stars, v_comet_scrolls, v_current_mp;

  return jsonb_build_object(
    'gold', v_gold,
    'comet_count', v_comets,
    'fallen_star_count', v_fallen_stars,
    'comet_scroll_count', v_comet_scrolls,
    'current_mp', v_current_mp,
    'character_kills', v_character_kills,
    'account_kills', v_account_kills,
    'granted_items', v_granted_items
  );
end;
$$;

revoke all on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb, numeric, jsonb
) from public;
grant execute on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb, numeric, jsonb
) to service_role;

commit;
