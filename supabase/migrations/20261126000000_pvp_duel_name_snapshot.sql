-- Fix: PvpDuelBoard.tsx queried `characters` directly from the client for
-- both players' display names, which only worked by accident when both
-- duelists shared one account (RLS on `characters` restricts SELECT to your
-- own account's rows) -- the moment an opponent is on a different account
-- (first hit testing Switchee vs Huntard, 2026-08-31), their name silently
-- came back empty and the UI fell back to "Opponent" for everyone. Same
-- root shape as the documented "chat has no RLS path to another account's
-- characters row" reasoning behind chat_messages' own send-time name/VIP
-- snapshot -- the fix here is the same pattern: snapshot each player's name
-- onto the public pvp_duels row (already broadcast to both participants)
-- at duel-creation time instead of a live cross-account lookup.
begin;

alter table public.pvp_duels
  add column if not exists player_a_name text,
  add column if not exists player_b_name text;

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
  v_player_a_name text;
  v_player_b_name text;
begin
  if p_first_turn_character_id not in (p_player_a_character_id, p_player_b_character_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid_first_turn_character');
  end if;

  select name into v_player_a_name from public.characters where id = p_player_a_character_id;
  select name into v_player_b_name from public.characters where id = p_player_b_character_id;

  insert into public.pvp_duels (
    player_a_character_id, player_b_character_id,
    player_a_name, player_b_name,
    player_a_hp, player_b_hp, player_a_max_hp, player_b_max_hp,
    current_turn_character_id, status, turn_deadline
  ) values (
    p_player_a_character_id, p_player_b_character_id,
    v_player_a_name, v_player_b_name,
    p_player_a_hp, p_player_b_hp, p_player_a_hp, p_player_b_hp,
    p_first_turn_character_id, 'active', null -- still the temporary no-timer testing override
  )
  returning id into v_duel_id;

  return jsonb_build_object('ok', true, 'duel_id', v_duel_id);
end;
$$;

revoke all on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) from public;
grant execute on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) to service_role;

-- Backfill the currently-open Switchee vs Huntard test duel so the user
-- doesn't have to restart it.
update public.pvp_duels
set player_a_name = (select name from public.characters where id = pvp_duels.player_a_character_id),
    player_b_name = (select name from public.characters where id = pvp_duels.player_b_character_id)
where status = 'active';

commit;
