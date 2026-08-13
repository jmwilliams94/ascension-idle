-- Consolidate resolve-combat's Postgres round trips (2026-08-21, PostgREST
-- egress reduction). Real edge logs showed a single resolve-combat
-- invocation made ~15 separate PostgREST/RPC calls (character fetch, a CAS
-- claim UPDATE, enemy_types, equipped item_instances + item_templates, an
-- 8-way parallel read for room-check/achievements/account-bonus data, then
-- two write RPCs plus conditional drop inserts) at a 4s cadence while
-- fighting — the dominant driver of this project's Postgres call volume.
-- This migration adds three functions that let the Edge Function do the
-- same work in ~2-3 round trips: one to gather + claim, one small helper
-- to pick a random drop template server-side, one to apply every result
-- atomically. Reward math itself is untouched — this is purely a
-- data-access consolidation, same trust model as the existing
-- resolve_combat_apply_rewards/resolve_combat_apply_kill_counts (service-
-- role-only, no security definer, ownership already verified by the Edge
-- Function's own auth.getUser() check before any of these are called).
-- The old resolve_combat_apply_rewards/resolve_combat_apply_kill_counts
-- are left in place (nothing else references them, but no reason to force
-- a signature-drop migration for functions that still work fine) — the
-- Edge Function just stops calling them.
begin;

-- 1. Gather + claim. Replaces: the characters SELECT, the CAS-claim UPDATE,
--    the enemy_types lookup, the equipped item_instances + item_templates
--    two-step, and the 8-way Promise.all (room-check counts, composition
--    stones, character/account kill rows, the account's best claimed tier,
--    account_pets existence, players' zone bonus percentages).
--
--    Concurrency: preserves the exact optimistic-CAS semantics
--    resolve-combat already uses today (SELECT old value, then
--    UPDATE ... WHERE combat_last_resolved_at = <old value>) rather than
--    switching to a blocking `for update` lock — a losing/duplicate call
--    still gets an instant no-op response, not a delay, matching the
--    existing 2026-08-09 duplicate-reward-race fix exactly. Folding both
--    statements into one function call does shrink the race window versus
--    today's two-separate-HTTP-round-trips version, as a side effect.
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
    'required_level', it.required_level
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids_no_quiver);

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids_with_quiver));

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
    'player', v_player
  );
end;
$$;

revoke all on function public.resolve_combat_gather_state(uuid) from public;
grant execute on function public.resolve_combat_gather_state(uuid) to service_role;

-- 2. Drop-template picker. Replaces the module-scope getDropPool cache +
--    client-side family/nearest-level selection (pickLevelAppropriateTemplate's
--    server mirror) — real edge logs showed the cache wasn't actually
--    surviving between calls in practice (each concurrent Edge Function
--    isolate likely gets its own empty module scope), so this does the
--    same selection as a single indexed query instead of transferring the
--    whole eligible-template list over the wire. Called only when a drop
--    roll actually succeeds (rare, current DROP_CHANCE = 1/150/kill), not
--    once per resolve.
create or replace function public.pick_drop_template(p_class text, p_level integer)
returns jsonb
language plpgsql
as $$
declare
  v_family text;
  v_result jsonb;
begin
  select item_family into v_family
  from public.item_templates
  where item_family is not null
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag')
    and (required_class is null or required_class = p_class)
  group by item_family
  order by random()
  limit 1;

  if v_family is null then
    return null;
  end if;

  select jsonb_build_object('id', id, 'required_level', required_level, 'slot_type', slot_type)
  into v_result
  from public.item_templates
  where item_family = v_family
    and (required_class is null or required_class = p_class)
  order by abs(required_level - p_level)
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.pick_drop_template(text, integer) from public;
grant execute on function public.pick_drop_template(text, integer) to service_role;

-- 3. Apply every result atomically. Replaces
--    resolve_combat_apply_kill_counts + resolve_combat_apply_rewards + the
--    account_pets insert + the item_instances/loot_holding drop-granting
--    loops. Durability updates and the p_kills_delta<=0 no-op path work the
--    same as their old separate call sites did. Doesn't re-touch
--    combat_last_resolved_at — resolve_combat_gather_state's claim UPDATE
--    already advanced it for this window, so the old second write of the
--    same value (resolve_combat_apply_rewards used to set it again) is
--    dropped as redundant, not a behavior change.
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
  p_currency_drops jsonb default '[]'::jsonb
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
  v_drop jsonb;
  v_currency jsonb;
  v_granted_items jsonb := '[]'::jsonb;
  v_new_item public.item_instances%rowtype;
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
  end if;

  if jsonb_array_length(p_durability_updates) > 0 then
    update public.item_instances ii
    set durability = (u ->> 'durability')::numeric
    from jsonb_array_elements(p_durability_updates) as u
    where ii.id = (u ->> 'id')::uuid and ii.owner_id = p_character_id;
  end if;

  -- Item drops: live mode grants straight into item_instances (already
  -- confirmed to fit at roll time — see resolve-combat's own room-check),
  -- offline mode always routes to loot_holding regardless of room.
  for v_drop in select * from jsonb_array_elements(p_item_drops)
  loop
    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, durability)
      values (
        (v_drop ->> 'template_id')::uuid,
        p_character_id,
        (v_drop ->> 'required_level')::integer,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        coalesce((v_drop ->> 'max_durability')::numeric, 0)
      )
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level)
      values (
        p_character_id,
        (v_drop ->> 'template_id')::uuid,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer
      );
    end if;
  end loop;

  -- Currency drops: offline mode only (loot_holding routing) — live mode
  -- currency drops are plain deltas via p_comet_delta/p_fallen_star_delta.
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
    comet_scroll_count = comet_scroll_count + p_comet_scroll_delta
  where id = p_character_id
  returning gold, comet_count, fallen_star_count, comet_scroll_count
  into v_gold, v_comets, v_fallen_stars, v_comet_scrolls;

  return jsonb_build_object(
    'gold', v_gold,
    'comet_count', v_comets,
    'fallen_star_count', v_fallen_stars,
    'comet_scroll_count', v_comet_scrolls,
    'character_kills', v_character_kills,
    'account_kills', v_account_kills,
    'granted_items', v_granted_items
  );
end;
$$;

revoke all on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb
) from public;
grant execute on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb
) to service_role;

commit;
