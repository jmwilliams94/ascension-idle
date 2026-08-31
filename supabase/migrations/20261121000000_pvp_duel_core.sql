-- PvP Duel core primitive (2026-11-21) -- see CLAUDE.md's plan
-- nifty-riding-journal for the full design writeup (Phase 1 of 4).
--
-- A real-time, turn-based hidden-position duel between two characters (any
-- class -- no class abilities participate, see the Edge Function). Board is
-- a 9x9 grid (BOARD_SIZE below -- also duplicated in resolve-pvp-duel/
-- index.ts and, once Phase 2 lands, src/game/pvp/pvpConstants.ts; keep all
-- three in sync). Each "life": the defender secretly places a 3x3 zone
-- (ZONE_SIZE) somewhere on the board -- the zone's *position* is public
-- (pvp_duels.zone_origin_x/y), but which of its 9 tiles the defender is
-- actually standing on is not. The attacker guesses tiles inside that zone
-- one at a time; a miss permanently crosses that tile out
-- (eliminated_tiles) until the next zone is placed. A hit deals damage and
-- swaps who's attacking vs defending.
--
-- Two-table split is deliberate: pvp_duels is the public, realtime-
-- broadcast row (added to supabase_realtime below) -- everything on it is
-- safe for both participants (and spectators, later) to see. The secret
-- tile lives in pvp_duel_secrets instead, which has NO grant to
-- anon/authenticated at all -- only the two plain functions below
-- (service_role only, called from resolve-pvp-duel) ever read or write it.
-- This is the one genuinely new pattern versus every other shared-state
-- table in this game (world_boss_spawns etc. are public to everyone) --
-- "the guesser's client can never fetch this" is the entire security model,
-- so it gets its own table rather than a column-level grant that's easier
-- to get wrong.
--
-- turn_number is the CAS/fencing token, same shape as
-- resolve_combat_gather_state's p_session_id fencing
-- (20261119000000_resolve_combat_session_fencing.sql) -- every apply call
-- must pass the turn_number it last observed; a mismatch means a stale or
-- duplicate call and is rejected without writing.
--
-- No client insert/update grant on either table -- every write goes through
-- pvp_duel_apply_action (service_role only), invoked from the
-- resolve-pvp-duel Edge Function, same trust model as resolve-combat/
-- world-boss-attack.
--
-- Phase 1 has no matchmaking/tournament layer yet -- start_pvp_duel below is
-- a service_role-only test trigger (call it directly via
-- `npx supabase db query --linked` for now), not exposed to players. Real
-- duel creation is Phase 3's job.
begin;

-- ============================================================================
-- 1. Schema
-- ============================================================================

create table public.pvp_duels (
  id uuid primary key default gen_random_uuid(),
  player_a_character_id uuid not null references public.characters(id) on delete cascade,
  player_b_character_id uuid not null references public.characters(id) on delete cascade,
  player_a_hp integer not null,
  player_b_hp integer not null,
  player_a_max_hp integer not null,
  player_b_max_hp integer not null,
  -- Whichever of player_a/player_b is currently attacking this "life" -- the
  -- defender is derived as "whichever of the two this ISN'T", so roles never
  -- require swapping which column holds which character's HP.
  current_attacker_id uuid not null references public.characters(id),
  phase text not null default 'awaiting_zone' check (phase in ('awaiting_zone', 'awaiting_guess', 'finished')),
  zone_origin_x integer,
  zone_origin_y integer,
  eliminated_tiles jsonb not null default '[]'::jsonb,
  turn_deadline timestamptz,
  turn_number integer not null default 0,
  winner_character_id uuid references public.characters(id),
  status text not null default 'active' check (status in ('active', 'completed', 'forfeited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_attacker_id in (player_a_character_id, player_b_character_id)),
  check (player_a_character_id <> player_b_character_id)
);

alter table public.pvp_duels enable row level security;

create policy "PvP duels are publicly viewable"
  on public.pvp_duels for select using (true);

grant select on public.pvp_duels to authenticated;
-- No insert/update grant to any client role -- written only inside
-- start_pvp_duel/pvp_duel_apply_action (service_role, see grants below).

alter publication supabase_realtime add table public.pvp_duels;

create table public.pvp_duel_secrets (
  duel_id uuid primary key references public.pvp_duels(id) on delete cascade,
  secret_tile_index integer not null check (secret_tile_index between 0 and 8)
);

-- Deliberately NO grant to anon/authenticated at all, and no RLS policy
-- (RLS with zero grants is redundant but left disabled -- there is no client
-- role to write a policy for). Only service_role (the two functions below)
-- ever touches this table.

-- ============================================================================
-- 2. Test trigger (Phase 1 only -- superseded by Phase 3's tournament-driven
--    duel creation, not exposed to players)
-- ============================================================================

create or replace function public.start_pvp_duel(
  p_player_a_character_id uuid,
  p_player_b_character_id uuid,
  p_player_a_hp integer,
  p_player_b_hp integer,
  p_first_defender_character_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_duel_id uuid;
  v_first_attacker uuid;
begin
  if p_first_defender_character_id not in (p_player_a_character_id, p_player_b_character_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid_defender');
  end if;

  v_first_attacker := case
    when p_first_defender_character_id = p_player_a_character_id then p_player_b_character_id
    else p_player_a_character_id
  end;

  insert into public.pvp_duels (
    player_a_character_id, player_b_character_id,
    player_a_hp, player_b_hp, player_a_max_hp, player_b_max_hp,
    current_attacker_id, phase, status
  ) values (
    p_player_a_character_id, p_player_b_character_id,
    p_player_a_hp, p_player_b_hp, p_player_a_hp, p_player_b_hp,
    v_first_attacker, 'awaiting_zone', 'active'
  )
  returning id into v_duel_id;

  return jsonb_build_object('ok', true, 'duel_id', v_duel_id);
end;
$$;

revoke all on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) from public;
grant execute on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) to service_role;

-- ============================================================================
-- 3. Gather (read-only fetch + ownership/turn validation + lazy timeout)
-- ============================================================================

create or replace function public.pvp_duel_gather_state(p_duel_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_duel record;
  v_defender_id uuid;
  v_expected_actor uuid;
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

  -- Lazy timeout handling (same "advance on next call, no cron" pattern as
  -- ensure_world_boss_spawn) -- whoever owned the expired turn forfeits.
  if v_duel.turn_deadline is not null and now() > v_duel.turn_deadline then
    v_expected_actor := case
      when v_duel.phase = 'awaiting_zone' then
        case when v_duel.current_attacker_id = v_duel.player_a_character_id
          then v_duel.player_b_character_id else v_duel.player_a_character_id end
      else v_duel.current_attacker_id
    end;

    update public.pvp_duels
    set status = 'forfeited',
        phase = 'finished',
        winner_character_id = case when v_expected_actor = player_a_character_id
          then player_b_character_id else player_a_character_id end,
        turn_deadline = null,
        updated_at = now()
    where id = p_duel_id
    returning * into v_duel;

    return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'active', false, 'forfeited', true);
  end if;

  v_defender_id := case when v_duel.current_attacker_id = v_duel.player_a_character_id
    then v_duel.player_b_character_id else v_duel.player_a_character_id end;

  v_expected_actor := case when v_duel.phase = 'awaiting_zone' then v_defender_id else v_duel.current_attacker_id end;

  if p_character_id <> v_expected_actor then
    return jsonb_build_object('ok', false, 'error', 'not_your_turn', 'duel', to_jsonb(v_duel));
  end if;

  return jsonb_build_object(
    'ok', true,
    'active', true,
    'duel', to_jsonb(v_duel),
    'is_attacker', p_character_id = v_duel.current_attacker_id,
    -- Combat-relevant snapshots for BOTH sides, labeled by current role (not
    -- fixed a/b) so the Edge Function doesn't need to re-derive who's who --
    -- only needed by the caller when phase is 'awaiting_guess' (a hit is
    -- possible), harmless to always include otherwise.
    'attacker_character', (select to_jsonb(c) from public.characters c where c.id = v_duel.current_attacker_id),
    'attacker_equipped_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quality_tier', ii.quality_tier, 'composition_level', ii.composition_level,
        'durability', ii.durability, 'base_stats', it.base_stats, 'slot_type', it.slot_type,
        'sockets', coalesce(ii.sockets, '[]'::jsonb)
      )), '[]'::jsonb)
      from public.characters c
      join public.item_instances ii on ii.id = any(array_remove(array[
        c.equipped_weapon_id, c.equipped_ring_id, c.equipped_necklace_id,
        c.equipped_boots_id, c.equipped_hat_id, c.equipped_coat_id
      ], null))
      join public.item_templates it on it.id = ii.template_id
      where c.id = v_duel.current_attacker_id
    ),
    'defender_character', (select to_jsonb(c) from public.characters c where c.id = v_defender_id),
    'defender_equipped_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quality_tier', ii.quality_tier, 'composition_level', ii.composition_level,
        'durability', ii.durability, 'base_stats', it.base_stats, 'slot_type', it.slot_type,
        'sockets', coalesce(ii.sockets, '[]'::jsonb)
      )), '[]'::jsonb)
      from public.characters c
      join public.item_instances ii on ii.id = any(array_remove(array[
        c.equipped_weapon_id, c.equipped_ring_id, c.equipped_necklace_id,
        c.equipped_boots_id, c.equipped_hat_id, c.equipped_coat_id
      ], null))
      join public.item_templates it on it.id = ii.template_id
      where c.id = v_defender_id
    )
  );
end;
$$;

revoke all on function public.pvp_duel_gather_state(uuid, uuid) from public;
grant execute on function public.pvp_duel_gather_state(uuid, uuid) to service_role;

-- ============================================================================
-- 4. Apply (authoritative write, re-validates everything under row lock)
-- ============================================================================

-- p_action shapes:
--   place_zone: {"type":"place_zone","zone_x":n,"zone_y":n,"secret_tile":n}
--   guess:      {"type":"guess","tile":n}
-- p_potential_damage: precomputed by the Edge Function (attacker's attack vs
-- defender's defense, PvP multiplier already applied) BEFORE knowing if the
-- guess will land -- only actually applied here if the secret comparison
-- (which never leaves this function) confirms a hit. A miss simply discards
-- it. Board size (9) and zone size (3) are inlined below rather than pulled
-- from a shared constant -- SQL can't import the TS/JS constant this mirrors
-- (src/game/pvp/pvpConstants.ts, once Phase 2 exists) or vice versa; keep
-- both in sync by hand, same as every other cross-runtime constant in this
-- project.
create or replace function public.pvp_duel_apply_action(
  p_duel_id uuid,
  p_character_id uuid,
  p_turn_number integer,
  p_action jsonb,
  p_potential_damage integer default 0
)
returns jsonb
language plpgsql
as $$
declare
  v_duel public.pvp_duels;
  v_defender_id uuid;
  v_expected_actor uuid;
  v_action_type text;
  v_zone_x integer;
  v_zone_y integer;
  v_secret_tile integer;
  v_guess_tile integer;
  v_actual_secret integer;
  v_is_hit boolean;
  v_new_defender_hp integer;
begin
  select * into v_duel from public.pvp_duels where id = p_duel_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_duel.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'duel_not_active', 'duel', to_jsonb(v_duel));
  end if;

  if v_duel.turn_number <> p_turn_number then
    return jsonb_build_object('ok', false, 'error', 'stale_turn', 'duel', to_jsonb(v_duel));
  end if;

  if v_duel.turn_deadline is not null and now() > v_duel.turn_deadline then
    v_expected_actor := case
      when v_duel.phase = 'awaiting_zone' then
        case when v_duel.current_attacker_id = v_duel.player_a_character_id
          then v_duel.player_b_character_id else v_duel.player_a_character_id end
      else v_duel.current_attacker_id
    end;
    update public.pvp_duels
    set status = 'forfeited', phase = 'finished', turn_deadline = null, updated_at = now(),
        winner_character_id = case when v_expected_actor = player_a_character_id
          then player_b_character_id else player_a_character_id end
    where id = p_duel_id
    returning * into v_duel;
    return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'forfeited', true);
  end if;

  v_defender_id := case when v_duel.current_attacker_id = v_duel.player_a_character_id
    then v_duel.player_b_character_id else v_duel.player_a_character_id end;
  v_expected_actor := case when v_duel.phase = 'awaiting_zone' then v_defender_id else v_duel.current_attacker_id end;

  if p_character_id <> v_expected_actor then
    return jsonb_build_object('ok', false, 'error', 'not_your_turn', 'duel', to_jsonb(v_duel));
  end if;

  v_action_type := p_action->>'type';

  if v_duel.phase = 'awaiting_zone' and v_action_type = 'place_zone' then
    v_zone_x := (p_action->>'zone_x')::integer;
    v_zone_y := (p_action->>'zone_y')::integer;
    v_secret_tile := (p_action->>'secret_tile')::integer;

    if v_zone_x is null or v_zone_y is null or v_secret_tile is null
       or v_zone_x < 0 or v_zone_x > 6 or v_zone_y < 0 or v_zone_y > 6
       or v_secret_tile < 0 or v_secret_tile > 8 then
      return jsonb_build_object('ok', false, 'error', 'invalid_action', 'duel', to_jsonb(v_duel));
    end if;

    update public.pvp_duels
    set zone_origin_x = v_zone_x, zone_origin_y = v_zone_y,
        eliminated_tiles = '[]'::jsonb, phase = 'awaiting_guess',
        turn_deadline = now() + interval '15 seconds', turn_number = turn_number + 1,
        updated_at = now()
    where id = p_duel_id
    returning * into v_duel;

    insert into public.pvp_duel_secrets (duel_id, secret_tile_index)
    values (p_duel_id, v_secret_tile)
    on conflict (duel_id) do update set secret_tile_index = excluded.secret_tile_index;

    return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'hit', false);

  elsif v_duel.phase = 'awaiting_guess' and v_action_type = 'guess' then
    v_guess_tile := (p_action->>'tile')::integer;

    if v_guess_tile is null or v_guess_tile < 0 or v_guess_tile > 8
       or v_duel.eliminated_tiles @> to_jsonb(v_guess_tile) then
      return jsonb_build_object('ok', false, 'error', 'invalid_action', 'duel', to_jsonb(v_duel));
    end if;

    select secret_tile_index into v_actual_secret from public.pvp_duel_secrets where duel_id = p_duel_id;
    v_is_hit := v_actual_secret is not null and v_actual_secret = v_guess_tile;

    if v_is_hit then
      v_new_defender_hp := greatest(0, (case when v_defender_id = v_duel.player_a_character_id
        then v_duel.player_a_hp else v_duel.player_b_hp end) - p_potential_damage);

      delete from public.pvp_duel_secrets where duel_id = p_duel_id;

      if v_defender_id = v_duel.player_a_character_id then
        update public.pvp_duels
        set player_a_hp = v_new_defender_hp,
            status = case when v_new_defender_hp <= 0 then 'completed' else 'active' end,
            phase = case when v_new_defender_hp <= 0 then 'finished' else 'awaiting_zone' end,
            winner_character_id = case when v_new_defender_hp <= 0 then current_attacker_id else null end,
            current_attacker_id = case when v_new_defender_hp <= 0 then current_attacker_id else v_defender_id end,
            zone_origin_x = null, zone_origin_y = null, eliminated_tiles = '[]'::jsonb,
            turn_deadline = case when v_new_defender_hp <= 0 then null else now() + interval '15 seconds' end,
            turn_number = turn_number + 1, updated_at = now()
        where id = p_duel_id
        returning * into v_duel;
      else
        update public.pvp_duels
        set player_b_hp = v_new_defender_hp,
            status = case when v_new_defender_hp <= 0 then 'completed' else 'active' end,
            phase = case when v_new_defender_hp <= 0 then 'finished' else 'awaiting_zone' end,
            winner_character_id = case when v_new_defender_hp <= 0 then current_attacker_id else null end,
            current_attacker_id = case when v_new_defender_hp <= 0 then current_attacker_id else v_defender_id end,
            zone_origin_x = null, zone_origin_y = null, eliminated_tiles = '[]'::jsonb,
            turn_deadline = case when v_new_defender_hp <= 0 then null else now() + interval '15 seconds' end,
            turn_number = turn_number + 1, updated_at = now()
        where id = p_duel_id
        returning * into v_duel;
      end if;

      return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'hit', true, 'damage_dealt', p_potential_damage);
    else
      update public.pvp_duels
      set eliminated_tiles = eliminated_tiles || to_jsonb(v_guess_tile),
          turn_deadline = now() + interval '15 seconds', turn_number = turn_number + 1,
          updated_at = now()
      where id = p_duel_id
      returning * into v_duel;

      return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'hit', false);
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'phase_action_mismatch', 'duel', to_jsonb(v_duel));
  end if;
end;
$$;

revoke all on function public.pvp_duel_apply_action(uuid, uuid, integer, jsonb, integer) from public;
grant execute on function public.pvp_duel_apply_action(uuid, uuid, integer, jsonb, integer) to service_role;

commit;
