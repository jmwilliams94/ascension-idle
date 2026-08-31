-- PvP Duel mechanic change (2026-08-31, requested by the user after
-- hands-on testing): a miss now ends the attacker's turn and swaps roles,
-- same as a hit -- supersedes the original "keep guessing the same zone,
-- misses just cross out tiles" design from 20261121000000_pvp_duel_core.sql.
-- Every guess is now a single attempt per turn: hit or miss, the zone is
-- discarded and the new defender must place a fresh one. eliminated_tiles
-- stays on the schema (still reset to '[]' on every new zone) but never
-- accumulates more than the SQL always overwriting it -- there is no longer
-- a multi-guess window in which a tile could ever get crossed out.
--
-- Same signature as the original function (only the body changes), so
-- `create or replace` is safe without a `drop function` first -- see
-- CLAUDE.md's gotcha on that, which only applies to an argument-list change.
begin;

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
  v_defender_hp_before integer;
  v_new_defender_hp integer;
  v_duel_over boolean;
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

    if v_guess_tile is null or v_guess_tile < 0 or v_guess_tile > 8 then
      return jsonb_build_object('ok', false, 'error', 'invalid_action', 'duel', to_jsonb(v_duel));
    end if;

    select secret_tile_index into v_actual_secret from public.pvp_duel_secrets where duel_id = p_duel_id;
    v_is_hit := v_actual_secret is not null and v_actual_secret = v_guess_tile;

    delete from public.pvp_duel_secrets where duel_id = p_duel_id;

    v_defender_hp_before := case when v_defender_id = v_duel.player_a_character_id
      then v_duel.player_a_hp else v_duel.player_b_hp end;
    v_new_defender_hp := case when v_is_hit then greatest(0, v_defender_hp_before - p_potential_damage) else v_defender_hp_before end;
    v_duel_over := v_is_hit and v_new_defender_hp <= 0;

    -- Every guess ends the round regardless of outcome (2026-08-31 change) --
    -- roles swap, the zone is discarded, and the new defender must place a
    -- fresh one next. A miss costs the attacker their turn but no HP; only a
    -- lethal hit skips the role-swap (the duel is over instead).
    if v_defender_id = v_duel.player_a_character_id then
      update public.pvp_duels
      set player_a_hp = v_new_defender_hp,
          status = case when v_duel_over then 'completed' else 'active' end,
          phase = case when v_duel_over then 'finished' else 'awaiting_zone' end,
          winner_character_id = case when v_duel_over then current_attacker_id else null end,
          current_attacker_id = case when v_duel_over then current_attacker_id else v_defender_id end,
          zone_origin_x = null, zone_origin_y = null, eliminated_tiles = '[]'::jsonb,
          turn_deadline = case when v_duel_over then null else now() + interval '15 seconds' end,
          turn_number = turn_number + 1, updated_at = now()
      where id = p_duel_id
      returning * into v_duel;
    else
      update public.pvp_duels
      set player_b_hp = v_new_defender_hp,
          status = case when v_duel_over then 'completed' else 'active' end,
          phase = case when v_duel_over then 'finished' else 'awaiting_zone' end,
          winner_character_id = case when v_duel_over then current_attacker_id else null end,
          current_attacker_id = case when v_duel_over then current_attacker_id else v_defender_id end,
          zone_origin_x = null, zone_origin_y = null, eliminated_tiles = '[]'::jsonb,
          turn_deadline = case when v_duel_over then null else now() + interval '15 seconds' end,
          turn_number = turn_number + 1, updated_at = now()
      where id = p_duel_id
      returning * into v_duel;
    end if;

    return jsonb_build_object(
      'ok', true, 'duel', to_jsonb(v_duel), 'hit', v_is_hit,
      'damage_dealt', case when v_is_hit then p_potential_damage else null end
    );
  else
    return jsonb_build_object('ok', false, 'error', 'phase_action_mismatch', 'duel', to_jsonb(v_duel));
  end if;
end;
$$;

revoke all on function public.pvp_duel_apply_action(uuid, uuid, integer, jsonb, integer) from public;
grant execute on function public.pvp_duel_apply_action(uuid, uuid, integer, jsonb, integer) to service_role;

commit;
