-- Server-side backstop for "one client at a time" (reported by the user:
-- actively fighting with mana on the Hunting tab, seeing no toast/EXP, while
-- the database showed real kills being credited elsewhere). Root cause: the
-- existing session-conflict UX (GlobalActivityConnection.tsx/
-- SessionConflictModal.tsx) is a purely client-cooperative handshake over a
-- Realtime broadcast -- the "loser" only signs itself out if its tab is
-- actively connected and processes that broadcast at the right moment. A
-- backgrounded/throttled/reconnecting tab can miss it entirely, leaving two
-- sessions both polling resolve-combat for the same character indefinitely
-- (serializeByKey's de-dup is per-JS-runtime, not cross-tab), racing for
-- reward credit with no server-side concept of which session should win.
--
-- players.current_session_id is now the source of truth for which of an
-- account's (possibly several concurrent) sessions is allowed to actually
-- earn combat rewards. claim_account_session lets a tab claim it -- called
-- client-side (see GlobalActivityConnection.tsx) either immediately on
-- connect when no conflict was detected, or when the user picks "Sign Out
-- Other Session & Continue" in the conflict modal. resolve_combat_gather_state
-- now takes the caller's own session id and refuses to even start the
-- combat_last_resolved_at CAS claim if it doesn't match the account's current
-- one -- so a stale session neither earns rewards nor burns the elapsed
-- window for whichever session actually is current. The realtime broadcast
-- eviction stays in place as the fast, cooperative path; this is the hard
-- fallback for when that message never lands. resolve-combat/index.ts treats
-- the new session_superseded flag as a distinct error so the client can
-- immediately sign itself out (resolveCombat.ts), rather than only relying on
-- the broadcast ever reaching it.
begin;

alter table public.players
  add column if not exists current_session_id text;

create or replace function public.claim_account_session(p_session_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.players set current_session_id = p_session_id where id = auth.uid();
$$;

revoke all on function public.claim_account_session(text) from public;
grant execute on function public.claim_account_session(text) to authenticated;

-- Signature change (new p_session_id param) -- explicit drop first, see
-- CLAUDE.md's own gotcha on this (create-or-replace with a different
-- signature creates a second, ambiguous overload instead of replacing it).
drop function if exists public.resolve_combat_gather_state(uuid);

-- Full body otherwise copied verbatim from
-- 20261029000000_resolve_combat_gather_state_pickaxe_room_check.sql (the
-- function's current latest definition) -- only the new p_session_id param
-- and the fencing check right after v_account_id is known (before the CAS
-- claim below it) are new.
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

  -- Session fencing (see this migration's own header) -- checked before the
  -- CAS claim below so a superseded session never advances
  -- combat_last_resolved_at on the current session's behalf. A null
  -- p_session_id (an old, not-yet-updated client) or a null
  -- current_session_id (account has never claimed one) both skip enforcement
  -- rather than block -- this only ever fences a session out once some
  -- session has actually claimed the account.
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

  -- Room-check only: layers the Pickaxe's own dedicated equip pointer on top
  -- (see 20261029000000's header note) -- must NOT feed the equipped_items
  -- stat query above/below, since Pickaxe contributes no combat stats.
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

revoke all on function public.resolve_combat_gather_state(uuid, text) from public;
grant execute on function public.resolve_combat_gather_state(uuid, text) to service_role;

commit;
