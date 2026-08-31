-- TEMPORARY testing override (2026-08-31, requested by the user): disables
-- the 15s turn timer entirely so a full round can be played through without
-- racing the clock. turn_deadline is now always set to null on every action
-- instead of now() + interval '15 seconds' -- the lazy timeout-forfeit
-- check in both pvp_duel_gather_state and pvp_duel_apply_action is already
-- guarded by `if turn_deadline is not null`, so this naturally disarms it
-- rather than needing separate logic. PvpTurnTimer.tsx already renders
-- nothing when deadline is null, so the client needs no change either.
--
-- REVERT by replacing every `null` this migration introduces back with
-- `now() + interval '15 seconds'` in a follow-up migration (search this
-- file's diff against 20261124000000_pvp_duel_symmetric_hiding.sql for the
-- exact 5 spots) once testing is done -- do not leave this in place for
-- real matchmaking (Phase 3).
begin;

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
    p_first_turn_character_id, 'active', null
  )
  returning id into v_duel_id;

  return jsonb_build_object('ok', true, 'duel_id', v_duel_id);
end;
$$;

revoke all on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) from public;
grant execute on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) to service_role;

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
          turn_deadline = null, turn_number = turn_number + 1, updated_at = now()
      where id = p_duel_id
      returning * into v_duel;
    else
      update public.pvp_duels
      set player_b_zone_x = v_zone_x, player_b_zone_y = v_zone_y, player_b_eliminated_tiles = '[]'::jsonb,
          current_turn_character_id = v_opponent_id,
          turn_deadline = null, turn_number = turn_number + 1, updated_at = now()
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

    if v_is_a then
      update public.pvp_duels
      set player_b_hp = v_new_opponent_hp,
          player_b_eliminated_tiles = case when v_is_hit then '[]'::jsonb else player_b_eliminated_tiles || to_jsonb(v_guess_tile) end,
          player_b_zone_x = case when v_is_hit and not v_duel_over then null else player_b_zone_x end,
          player_b_zone_y = case when v_is_hit and not v_duel_over then null else player_b_zone_y end,
          status = case when v_duel_over then 'completed' else 'active' end,
          winner_character_id = case when v_duel_over then p_character_id else null end,
          current_turn_character_id = case when v_duel_over then p_character_id else v_opponent_id end,
          turn_deadline = null,
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
          turn_deadline = null,
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
