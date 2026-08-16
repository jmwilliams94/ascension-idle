-- Row Combat, Phase 1 (see notes/ for the full design plan this was built
-- from). A new, LIVE-ONLY combat mode: up to 6 concurrent enemy slots per
-- row, across two independently-unlockable rows (12 slots total per
-- character), fought alongside — but mutually exclusive with — today's
-- single-target continuous combat. Slots are toggled on/off individually;
-- toggling one on spawns whatever monster is currently selected via the
-- existing zone/monster picker (characters.selected_monster_id), not a
-- separate fixed roster, so each slot can end up hosting a different
-- monster type depending on when it was toggled on.
--
-- Deliberately separate claim/state from single-target combat
-- (row_combat_last_resolved_at, not combat_last_resolved_at) so the two
-- systems' CAS-claims and elapsed-time accounting never cross-contaminate,
-- even though only one is ever "live" at a time in normal play.
--
-- No offline/idle path exists for this mode at all — going AFK (tab hidden/
-- beforeunload) must fully stop accrual. The gather RPC below enforces a
-- hard 10s liveness cutoff (ROW_LIVE_LIVENESS_THRESHOLD_MS, mirrored in the
-- Edge Function) rather than the multi-hour bounded AFK cap single-target
-- combat uses for genuine catch-up — row combat has no catch-up concept.
begin;

-- 1. Schema. jsonb for row_slots (not a join table) — matches this
--    project's existing convention (composition_stones, gems) for "exactly
--    one session-shaped blob per character, always read/written as a
--    whole." Index 0-5 = Row 1, 6-11 = Row 2. Each element:
--    { enabled, monster_id, current_hp, max_hp, is_rare, dead_at }.
--    Every mutation goes through a security definer RPC below — per
--    20260821000000_lock_down_direct_table_writes.sql, `characters` has no
--    general UPDATE grant to authenticated anymore, so these new columns
--    are unreachable from a plain client update by construction; no new
--    grant is needed (or wanted) for them.
alter table public.characters
  add column if not exists row_slots jsonb not null default '[]'::jsonb,
  add column if not exists row_multi_shot_last_fired_at timestamptz not null default now(),
  add column if not exists row_combat_last_resolved_at timestamptz not null default now(),
  add column if not exists row1_unlocked boolean not null default false,
  add column if not exists row2_unlocked boolean not null default false;

-- 2. Gather + claim. Mirrors resolve_combat_gather_state's shape/CAS-claim
--    pattern exactly, but claims row_combat_last_resolved_at instead, and
--    returns enemy_types for every DISTINCT monster id present across the
--    12 slots (row combat can have several different monster types live at
--    once) rather than a single monster row.
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
    'player', v_player
  );
end;
$$;

revoke all on function public.resolve_row_combat_gather_state(uuid) from public;
grant execute on function public.resolve_row_combat_gather_state(uuid) to service_role;

-- 3. Compensating rollback — direct copy of resolve_combat_release_claim's
--    exact-CAS shape, scoped to row_combat_last_resolved_at.
create or replace function public.resolve_row_combat_release_claim(
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
  set row_combat_last_resolved_at = p_restore_to
  where id = p_character_id and row_combat_last_resolved_at = p_claimed_at;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.resolve_row_combat_release_claim(uuid, timestamptz, timestamptz) from public;
grant execute on function public.resolve_row_combat_release_claim(uuid, timestamptz, timestamptz) to service_role;

-- 4. Apply every result atomically. Unlike resolve_combat_apply_results,
--    kills are real discrete events from the Edge Function's own
--    event-walk (not a fractional "whole kills crossed" approximation), so
--    p_kill_deltas is a small jsonb array of {monster_id, kills} pairs
--    (one entry per distinct monster type actually killed this window) —
--    looped rather than a single scalar delta, since row slots can host
--    different monster types simultaneously. Always live-mode semantics
--    (item drops go straight to item_instances) — there is no offline path
--    for this mode, so no p_mode param is needed at all.
create or replace function public.resolve_row_combat_apply_results(
  p_character_id uuid,
  p_account_id uuid,
  p_kill_deltas jsonb,
  p_gold_delta integer,
  p_exp integer,
  p_level integer,
  p_comet_delta integer,
  p_fallen_star_delta integer,
  p_pet_obtained_monster_id text default null,
  p_item_drops jsonb default '[]'::jsonb,
  p_row_slots jsonb default '[]'::jsonb,
  p_row_multi_shot_last_fired_at timestamptz default null
)
returns jsonb
language plpgsql
as $$
declare
  v_delta jsonb;
  v_drop jsonb;
  v_gold integer;
  v_comets integer;
  v_fallen_stars integer;
  v_granted_items jsonb := '[]'::jsonb;
  v_new_item public.item_instances%rowtype;
  v_char_kills numeric;
  v_account_kills numeric;
  v_kill_count_updates jsonb := '[]'::jsonb;
begin
  for v_delta in select * from jsonb_array_elements(coalesce(p_kill_deltas, '[]'::jsonb))
  loop
    insert into public.character_monster_kills (character_id, monster_id, kills)
    values (p_character_id, v_delta ->> 'monster_id', (v_delta ->> 'kills')::numeric)
    on conflict (character_id, monster_id)
    do update set kills = public.character_monster_kills.kills + excluded.kills
    returning kills into v_char_kills;

    insert into public.account_monster_kills (account_id, monster_id, kills)
    values (p_account_id, v_delta ->> 'monster_id', (v_delta ->> 'kills')::numeric)
    on conflict (account_id, monster_id)
    do update set kills = public.account_monster_kills.kills + excluded.kills
    returning kills into v_account_kills;

    v_kill_count_updates := v_kill_count_updates || jsonb_build_array(jsonb_build_object(
      'monster_id', v_delta ->> 'monster_id',
      'character_kills', v_char_kills,
      'account_kills', v_account_kills
    ));
  end loop;

  if p_pet_obtained_monster_id is not null then
    insert into public.account_pets (account_id, monster_id)
    values (p_account_id, p_pet_obtained_monster_id)
    on conflict do nothing;
  end if;

  -- Live-mode-only granting — always straight into item_instances (the
  -- Edge Function's own event-walk already stops rolling further drops the
  -- moment a room check fails, mirroring single-target live combat's
  -- "a full inventory should stop combat").
  for v_drop in select * from jsonb_array_elements(p_item_drops)
  loop
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
  end loop;

  update public.characters
  set
    gold = gold + p_gold_delta,
    exp = p_exp,
    level = p_level,
    comet_count = comet_count + p_comet_delta,
    fallen_star_count = fallen_star_count + p_fallen_star_delta,
    row_slots = p_row_slots,
    row_multi_shot_last_fired_at = coalesce(p_row_multi_shot_last_fired_at, row_multi_shot_last_fired_at)
  where id = p_character_id
  returning gold, comet_count, fallen_star_count
  into v_gold, v_comets, v_fallen_stars;

  return jsonb_build_object(
    'gold', v_gold,
    'comet_count', v_comets,
    'fallen_star_count', v_fallen_stars,
    'granted_items', v_granted_items,
    'row_slots', p_row_slots,
    'kill_count_updates', v_kill_count_updates
  );
end;
$$;

revoke all on function public.resolve_row_combat_apply_results(
  uuid, uuid, jsonb, integer, integer, integer, integer, integer, text, jsonb, jsonb, timestamptz
) from public;
grant execute on function public.resolve_row_combat_apply_results(
  uuid, uuid, jsonb, integer, integer, integer, integer, integer, text, jsonb, jsonb, timestamptz
) to service_role;

-- 5. toggle_row_slot — the one client-facing mutation for turning a slot
--    on/off. Ownership-checked, security definer. Reads
--    characters.selected_monster_id SERVER-SIDE (never trusts a
--    client-passed monster id, same convention resolve-combat already
--    follows for its own monster selection). Turning a slot on rolls a
--    fresh spawn (fresh HP roll + a rare roll, mirrors
--    combatResolver.ts's spawnMonsterHp/rollIsRare — RARE_CHANCE=0.05,
--    RARE_HP_MULTIPLIER=2, must stay in sync). Turning off clears the slot
--    outright — no partial-kill credit for whatever HP was left.
--
--    IMPORTANT ordering requirement (enforced client-side, not here): the
--    caller must always resolve any pending row-combat time (call
--    resolve-row-combat) before calling this, so in-flight damage/kills
--    settle against the PRE-toggle slot state first.
create or replace function public.toggle_row_slot(p_character_id uuid, p_slot_index smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_selected_monster_id text;
  v_row1_unlocked boolean;
  v_row2_unlocked boolean;
  v_row_slots jsonb;
  v_slot jsonb;
  v_new_slot jsonb;
  v_monster_level integer;
  v_monster_max_hp integer;
  v_is_rare boolean;
  v_hp integer;
begin
  if p_slot_index < 0 or p_slot_index > 11 then
    return jsonb_build_object('ok', false, 'error', 'invalid_slot');
  end if;

  select account_id, selected_monster_id, row1_unlocked, row2_unlocked, row_slots
  into v_account_id, v_selected_monster_id, v_row1_unlocked, v_row2_unlocked, v_row_slots
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if (p_slot_index < 6 and not v_row1_unlocked) or (p_slot_index >= 6 and not v_row2_unlocked) then
    return jsonb_build_object('ok', false, 'error', 'row_locked');
  end if;

  -- row_slots may still be the '[]' default before this character's first
  -- ever toggle — pad it out to 12 empty slots on first use.
  if v_row_slots is null or jsonb_array_length(v_row_slots) < 12 then
    v_row_slots := (
      select coalesce(jsonb_agg(coalesce(v_row_slots -> g.i, jsonb_build_object(
        'enabled', false, 'monster_id', null, 'current_hp', 0, 'max_hp', 0, 'is_rare', false, 'dead_at', null
      ))), '[]'::jsonb)
      from generate_series(0, 11) as g(i)
    );
  end if;

  v_slot := v_row_slots -> p_slot_index;

  if coalesce((v_slot ->> 'enabled')::boolean, false) then
    -- Turning off — clear outright, no partial credit.
    v_new_slot := jsonb_build_object(
      'enabled', false, 'monster_id', null, 'current_hp', 0, 'max_hp', 0, 'is_rare', false, 'dead_at', null
    );
  else
    if v_selected_monster_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_monster_selected');
    end if;

    select level, max_hp into v_monster_level, v_monster_max_hp
    from public.enemy_types
    where id = v_selected_monster_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'unknown_monster');
    end if;

    -- Mirrors combatResolver.ts's rollIsRare/spawnMonsterHp exactly.
    v_is_rare := random() < 0.05;
    v_hp := case when v_is_rare then round(v_monster_max_hp * 2) else v_monster_max_hp end;

    v_new_slot := jsonb_build_object(
      'enabled', true,
      'monster_id', v_selected_monster_id,
      'current_hp', v_hp,
      'max_hp', v_hp,
      'is_rare', v_is_rare,
      'dead_at', null
    );
  end if;

  v_row_slots := jsonb_set(v_row_slots, array[p_slot_index::text], v_new_slot);

  update public.characters set row_slots = v_row_slots where id = p_character_id;

  return jsonb_build_object('ok', true, 'row_slots', v_row_slots);
end;
$$;

revoke all on function public.toggle_row_slot(uuid, smallint) from public;
grant execute on function public.toggle_row_slot(uuid, smallint) to authenticated;

-- 6. claim_row_unlock — mirrors claim_kill_count_reward's "explicit claim,
--    not automatic" shape, reusing the EXISTING per-character Kill Count
--    ladder rather than a new metric: unlocks Row 1/Row 2 once this
--    character has claimed at least the given tier index on ANY ONE
--    monster's own ladder (mirrors resolve_combat_gather_state's
--    "best_claimed_tier" pattern, just per-character instead of
--    account-wide). Placeholder thresholds, explicitly tunable: Row 1 at
--    tier 2 (250 kills, ACHIEVEMENT_TIERS[1]), Row 2 at tier 4 (1000
--    kills, ACHIEVEMENT_TIERS[3]). Pure capability grant — no item/
--    currency reward, unlike claim_kill_count_reward.
create or replace function public.claim_row_unlock(p_character_id uuid, p_row smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_best_tier integer;
  v_required_tier integer;
  v_already_unlocked boolean;
begin
  if p_row not in (1, 2) then
    return jsonb_build_object('ok', false, 'error', 'invalid_row');
  end if;

  select account_id,
         case when p_row = 1 then row1_unlocked else row2_unlocked end
  into v_account_id, v_already_unlocked
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_already_unlocked then
    return jsonb_build_object('ok', true, 'already_unlocked', true);
  end if;

  select coalesce(max(claimed_tier_index), 0) into v_best_tier
  from public.character_monster_kills
  where character_id = p_character_id;

  v_required_tier := case p_row when 1 then 2 else 4 end;

  if v_best_tier < v_required_tier then
    return jsonb_build_object('ok', false, 'error', 'not_reached', 'required_tier', v_required_tier, 'best_tier', v_best_tier);
  end if;

  if p_row = 1 then
    update public.characters set row1_unlocked = true where id = p_character_id;
  else
    update public.characters set row2_unlocked = true where id = p_character_id;
  end if;

  return jsonb_build_object('ok', true, 'already_unlocked', false, 'row', p_row);
end;
$$;

revoke all on function public.claim_row_unlock(uuid, smallint) from public;
grant execute on function public.claim_row_unlock(uuid, smallint) to authenticated;

commit;
