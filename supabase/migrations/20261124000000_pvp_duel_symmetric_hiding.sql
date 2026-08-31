-- PvP Duel mechanic change (2026-08-31, requested by the user): both
-- players now hide simultaneously and take turns shooting at EACH OTHER's
-- zone, instead of one shared "current defender" whose zone the other
-- player attacks. Supersedes 20261121000000_pvp_duel_core.sql's single
-- shared-zone model and 20261123000000's single-guess-per-turn tweak (that
-- tweak's actual intent -- misses ending your turn -- is preserved, just
-- rebuilt on the new two-sided schema).
--
-- Turn model, now much simpler than before: current_turn_character_id
-- always alternates to the OTHER player after every single action (place a
-- zone, or guess), no exceptions. What that player's action MUST be is
-- derived, not stored: if THEIR OWN zone is unset (player_a_zone_x is
-- null), they must place_zone; otherwise they must guess (always targeting
-- the other player's zone, the only other participant in a 1v1). This
-- self-enforces the setup handshake too -- at duel start both zones are
-- null, so both players' first turns are forced to place_zone before either
-- can guess, with no separate "setup phase" needed.
--
-- Elimination memory (player_a_eliminated_tiles / player_b_eliminated_tiles)
-- now persists across every turn where that zone isn't touched, which is
-- exactly what makes "the turn coming back around" meaningful -- it's
-- reset to '[]' only when that zone's owner gets hit and must re-hide (a
-- fresh zone), never just because a turn passed.
--
-- pvp_duel_secrets' primary key changes from (duel_id) to
-- (duel_id, character_id) since both players now have their own secret
-- tile simultaneously, not one shared secret per duel.
begin;

drop table if exists public.pvp_duel_secrets;

create table public.pvp_duel_secrets (
  duel_id uuid not null references public.pvp_duels(id) on delete cascade,
  character_id uuid not null,
  secret_tile_index integer not null check (secret_tile_index between 0 and 8),
  primary key (duel_id, character_id)
);

-- Same deliberate non-grant as before -- no anon/authenticated access at
-- all, service_role only (see the grant at the bottom of this file, and
-- root CLAUDE.md's gotcha this project already got bitten by once on this
-- exact table).

alter table public.pvp_duels
  drop column if exists phase,
  drop column if exists zone_origin_x,
  drop column if exists zone_origin_y,
  drop column if exists eliminated_tiles;

alter table public.pvp_duels rename column current_attacker_id to current_turn_character_id;

alter table public.pvp_duels
  add column if not exists player_a_zone_x integer,
  add column if not exists player_a_zone_y integer,
  add column if not exists player_a_eliminated_tiles jsonb not null default '[]'::jsonb,
  add column if not exists player_b_zone_x integer,
  add column if not exists player_b_zone_y integer,
  add column if not exists player_b_eliminated_tiles jsonb not null default '[]'::jsonb;

grant all on public.pvp_duels to service_role;
grant all on public.pvp_duel_secrets to service_role;

-- ============================================================================
-- start_pvp_duel -- both zones start null (each player's first turn is
-- forced to place_zone by the derivation rule above), so this just needs to
-- seed HP and who goes first. p_first_defender_character_id renamed to
-- p_first_turn_character_id -- same types/count, but Postgres's
-- `create or replace function` rejects a PARAMETER NAME change outright
-- (not just a type/count change, learned the hard way here), so an explicit
-- drop is required first regardless.
-- ============================================================================
drop function if exists public.start_pvp_duel(uuid, uuid, integer, integer, uuid);

create or replace function public.start_pvp_duel(
  p_player_a_character_id uuid,
  p_player_b_character_id uuid,
  p_player_a_hp integer,
  p_player_b_hp integer,
  p_first_turn_character_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_duel_id uuid;
begin
  if p_first_turn_character_id not in (p_player_a_character_id, p_player_b_character_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid_first_turn_character');
  end if;

  insert into public.pvp_duels (
    player_a_character_id, player_b_character_id,
    player_a_hp, player_b_hp, player_a_max_hp, player_b_max_hp,
    current_turn_character_id, status, turn_deadline
  ) values (
    p_player_a_character_id, p_player_b_character_id,
    p_player_a_hp, p_player_b_hp, p_player_a_hp, p_player_b_hp,
    p_first_turn_character_id, 'active', now() + interval '15 seconds'
  )
  returning id into v_duel_id;

  return jsonb_build_object('ok', true, 'duel_id', v_duel_id);
end;
$$;

revoke all on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) from public;
grant execute on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) to service_role;

-- ============================================================================
-- pvp_duel_gather_state -- same 2-arg signature as before. required_action
-- replaces the old is_attacker flag; player_a_character/player_b_character
-- (+ equipped items) replace attacker_character/defender_character, since
-- there's no longer a fixed "who's attacking" label to hang those names on.
-- ============================================================================
create or replace function public.pvp_duel_gather_state(p_duel_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_duel record;
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
    update public.pvp_duels
    set status = 'forfeited', turn_deadline = null, updated_at = now(),
        winner_character_id = case when current_turn_character_id = player_a_character_id
          then player_b_character_id else player_a_character_id end
    where id = p_duel_id
    returning * into v_duel;
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
        'sockets', coalesce(ii.sockets, '[]'::jsonb)
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
        'sockets', coalesce(ii.sockets, '[]'::jsonb)
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

-- ============================================================================
-- pvp_duel_apply_action -- same 5-arg signature as before.
-- p_action shapes unchanged: place_zone {zone_x,zone_y,secret_tile} always
-- refers to the caller's OWN new zone; guess {tile} always targets the
-- OTHER player's zone (the only other participant in a 1v1).
-- ============================================================================
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
  v_action_type text;
  v_is_a boolean;
  v_opponent_id uuid;
  v_my_zone_x integer;
  v_required_action text;
  v_zone_x integer;
  v_zone_y integer;
  v_secret_tile integer;
  v_guess_tile integer;
  v_actual_secret integer;
  v_is_hit boolean;
  v_opponent_hp_before integer;
  v_new_opponent_hp integer;
  v_duel_over boolean;
  v_opponent_eliminated jsonb;
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
    update public.pvp_duels
    set status = 'forfeited', turn_deadline = null, updated_at = now(),
        winner_character_id = case when current_turn_character_id = player_a_character_id
          then player_b_character_id else player_a_character_id end
    where id = p_duel_id
    returning * into v_duel;
    return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'forfeited', true);
  end if;

  if p_character_id <> v_duel.current_turn_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_your_turn', 'duel', to_jsonb(v_duel));
  end if;

  v_is_a := p_character_id = v_duel.player_a_character_id;
  v_opponent_id := case when v_is_a then v_duel.player_b_character_id else v_duel.player_a_character_id end;
  v_my_zone_x := case when v_is_a then v_duel.player_a_zone_x else v_duel.player_b_zone_x end;
  v_required_action := case when v_my_zone_x is null then 'place_zone' else 'guess' end;

  v_action_type := p_action->>'type';

  if v_action_type <> v_required_action then
    return jsonb_build_object('ok', false, 'error', 'phase_action_mismatch', 'duel', to_jsonb(v_duel));
  end if;

  if v_action_type = 'place_zone' then
    v_zone_x := (p_action->>'zone_x')::integer;
    v_zone_y := (p_action->>'zone_y')::integer;
    v_secret_tile := (p_action->>'secret_tile')::integer;

    if v_zone_x is null or v_zone_y is null or v_secret_tile is null
       or v_zone_x < 0 or v_zone_x > 6 or v_zone_y < 0 or v_zone_y > 6
       or v_secret_tile < 0 or v_secret_tile > 8 then
      return jsonb_build_object('ok', false, 'error', 'invalid_action', 'duel', to_jsonb(v_duel));
    end if;

    if v_is_a then
      update public.pvp_duels
      set player_a_zone_x = v_zone_x, player_a_zone_y = v_zone_y, player_a_eliminated_tiles = '[]'::jsonb,
          current_turn_character_id = v_opponent_id,
          turn_deadline = now() + interval '15 seconds', turn_number = turn_number + 1, updated_at = now()
      where id = p_duel_id
      returning * into v_duel;
    else
      update public.pvp_duels
      set player_b_zone_x = v_zone_x, player_b_zone_y = v_zone_y, player_b_eliminated_tiles = '[]'::jsonb,
          current_turn_character_id = v_opponent_id,
          turn_deadline = now() + interval '15 seconds', turn_number = turn_number + 1, updated_at = now()
      where id = p_duel_id
      returning * into v_duel;
    end if;

    insert into public.pvp_duel_secrets (duel_id, character_id, secret_tile_index)
    values (p_duel_id, p_character_id, v_secret_tile)
    on conflict (duel_id, character_id) do update set secret_tile_index = excluded.secret_tile_index;

    return jsonb_build_object('ok', true, 'duel', to_jsonb(v_duel), 'hit', false);

  else -- 'guess', always against v_opponent_id's zone
    v_guess_tile := (p_action->>'tile')::integer;
    v_opponent_eliminated := case when v_is_a then v_duel.player_b_eliminated_tiles else v_duel.player_a_eliminated_tiles end;

    if v_guess_tile is null or v_guess_tile < 0 or v_guess_tile > 8
       or v_opponent_eliminated @> to_jsonb(v_guess_tile) then
      return jsonb_build_object('ok', false, 'error', 'invalid_action', 'duel', to_jsonb(v_duel));
    end if;

    select secret_tile_index into v_actual_secret
    from public.pvp_duel_secrets where duel_id = p_duel_id and character_id = v_opponent_id;
    v_is_hit := v_actual_secret is not null and v_actual_secret = v_guess_tile;

    if v_is_hit then
      delete from public.pvp_duel_secrets where duel_id = p_duel_id and character_id = v_opponent_id;
    end if;

    v_opponent_hp_before := case when v_is_a then v_duel.player_b_hp else v_duel.player_a_hp end;
    v_new_opponent_hp := case when v_is_hit then greatest(0, v_opponent_hp_before - p_potential_damage) else v_opponent_hp_before end;
    v_duel_over := v_is_hit and v_new_opponent_hp <= 0;

    -- Every guess ends the turn regardless of outcome. A miss is recorded
    -- against the opponent's zone (persists there until it's finally hit) --
    -- their own zone/position is otherwise untouched. A non-lethal hit
    -- clears their zone (they must place a fresh one on their next turn)
    -- and resets their eliminated-tiles memory along with it.
    if v_is_a then
      update public.pvp_duels
      set player_b_hp = v_new_opponent_hp,
          player_b_eliminated_tiles = case when v_is_hit then '[]'::jsonb else player_b_eliminated_tiles || to_jsonb(v_guess_tile) end,
          player_b_zone_x = case when v_is_hit and not v_duel_over then null else player_b_zone_x end,
          player_b_zone_y = case when v_is_hit and not v_duel_over then null else player_b_zone_y end,
          status = case when v_duel_over then 'completed' else 'active' end,
          winner_character_id = case when v_duel_over then p_character_id else null end,
          current_turn_character_id = case when v_duel_over then p_character_id else v_opponent_id end,
          turn_deadline = case when v_duel_over then null else now() + interval '15 seconds' end,
          turn_number = turn_number + 1, updated_at = now()
      where id = p_duel_id
      returning * into v_duel;
    else
      update public.pvp_duels
      set player_a_hp = v_new_opponent_hp,
          player_a_eliminated_tiles = case when v_is_hit then '[]'::jsonb else player_a_eliminated_tiles || to_jsonb(v_guess_tile) end,
          player_a_zone_x = case when v_is_hit and not v_duel_over then null else player_a_zone_x end,
          player_a_zone_y = case when v_is_hit and not v_duel_over then null else player_a_zone_y end,
          status = case when v_duel_over then 'completed' else 'active' end,
          winner_character_id = case when v_duel_over then p_character_id else null end,
          current_turn_character_id = case when v_duel_over then p_character_id else v_opponent_id end,
          turn_deadline = case when v_duel_over then null else now() + interval '15 seconds' end,
          turn_number = turn_number + 1, updated_at = now()
      where id = p_duel_id
      returning * into v_duel;
    end if;

    return jsonb_build_object(
      'ok', true, 'duel', to_jsonb(v_duel), 'hit', v_is_hit,
      'damage_dealt', case when v_is_hit then p_potential_damage else null end
    );
  end if;
end;
$$;

revoke all on function public.pvp_duel_apply_action(uuid, uuid, integer, jsonb, integer) from public;
grant execute on function public.pvp_duel_apply_action(uuid, uuid, integer, jsonb, integer) to service_role;

commit;
