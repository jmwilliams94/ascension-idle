-- PvP Tournament fixes (2026-09-05, requested by the user after a real
-- bracket got stuck): three backend changes plus one one-off data fix.
begin;

-- ============================================================================
-- 1) 3-minute no-show timer for a duel's very first action only. Every turn
-- after start_pvp_duel keeps the existing fast 15s pace (unchanged in
-- pvp_duel_apply_action) -- only the initial deadline changes, since a brand
-- new tournament match may sit unopened for a while before either player
-- notices it exists, unlike every later turn where both are already clearly
-- engaged. Same signature as 20261215000000_pvp_duel_reenable_timer.sql
-- (only the interval literal changes), so no drop function needed.
-- ============================================================================
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
    p_first_turn_character_id, 'active', now() + interval '3 minutes'
  )
  returning id into v_duel_id;

  return jsonb_build_object('ok', true, 'duel_id', v_duel_id);
end;
$$;

revoke all on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) from public;
grant execute on function public.start_pvp_duel(uuid, uuid, integer, integer, uuid) to service_role;

-- ============================================================================
-- 2) Active timeout sweep. Until now an expired turn_deadline was only ever
-- noticed lazily, inside pvp_duel_gather_state/pvp_duel_apply_action -- i.e.
-- only when SOME client actually called one of those for that exact duel. If
-- neither participant ever opens the match (a true no-show), nothing ever
-- calls either function for it and it sits forfeit-eligible forever. This is
-- exactly what happened 2026-09-05 (see the one-off fix below) -- Ethan never
-- opened the tournament final against Huntard, so its deadline expired with
-- no client ever around to discover it. A once-a-minute pg_cron sweep
-- (pg_cron's minimum granularity) closes that gap for both this new 3-minute
-- no-show window and the ongoing 15s per-turn pace, without depending on
-- either player being present.
-- ============================================================================
create or replace function public.pvp_duel_sweep_timeouts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duel record;
  v_winner uuid;
begin
  for v_duel in
    select * from public.pvp_duels
    where status = 'active' and turn_deadline is not null and turn_deadline < now()
    for update
  loop
    v_winner := case when v_duel.current_turn_character_id = v_duel.player_a_character_id
      then v_duel.player_b_character_id else v_duel.player_a_character_id end;

    update public.pvp_duels
    set status = 'forfeited', turn_deadline = null, updated_at = now(),
        winner_character_id = v_winner
    where id = v_duel.id;

    perform public.pvp_tournament_record_duel_result(v_duel.id, v_winner);
  end loop;
end;
$$;

revoke all on function public.pvp_duel_sweep_timeouts() from public;

select cron.schedule(
  'pvp-duel-timeout-sweep',
  '* * * * *',
  $$select public.pvp_duel_sweep_timeouts();$$
);

-- ============================================================================
-- 3) Registration for next week must not open until the CURRENT tournament
-- has actually finished. ensure_pvp_tournament_registration_open used to
-- create a new 'registration' row the instant none existed -- which happened
-- the moment the current tournament flipped to 'live' (registration closes
-- right there, see pvp_tournament_kickoff_if_due), immediately exposing next
-- week's signup while this week's bracket was still being played. Confirmed
-- live 2026-09-05: tournament 94548f18 (this week, 'live') coexisted with
-- ebad87b5 (next week, already 'registration') well before this week's
-- bracket had finished. Same signature (no args), so no drop function needed.
-- ============================================================================
create or replace function public.ensure_pvp_tournament_registration_open()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_utc_now timestamp;
  v_friday_utc timestamp;
begin
  select id into v_id from public.pvp_tournaments where status = 'registration' limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'tournament_id', v_id, 'created', false);
  end if;

  if exists (select 1 from public.pvp_tournaments where status = 'live') then
    return jsonb_build_object('ok', true, 'tournament_id', null, 'created', false);
  end if;

  v_utc_now := now() at time zone 'utc';
  -- date_trunc('week', ...) truncates to Monday 00:00 (ISO 8601); +4 days
  -- 2 hours lands on Friday 02:00 UTC of THIS week.
  v_friday_utc := date_trunc('week', v_utc_now) + interval '4 days 2 hours';
  if v_friday_utc <= v_utc_now then
    v_friday_utc := v_friday_utc + interval '7 days';
  end if;

  insert into public.pvp_tournaments (status, event_starts_at)
  values ('registration', v_friday_utc at time zone 'utc')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'tournament_id', v_id, 'created', true);
end;
$$;

revoke all on function public.ensure_pvp_tournament_registration_open() from public;
grant execute on function public.ensure_pvp_tournament_registration_open() to authenticated;

-- ============================================================================
-- 4) champion_title is now always 'Top Hunter', not 'Duel Champion'. The
-- tournament has been Hunter-only since
-- 20261215020000_pvp_tournament_hunter_only.sql, so every future champion
-- will in fact be a Hunter -- 'Duel Champion' predates that restriction. This
-- also drives the new rotating champion badge (client: TopHunterBadge.tsx /
-- useCurrentPvpChampion in usePvpTournamentStore.ts), which reads this column
-- directly rather than hardcoding the title client-side.
-- ============================================================================
create or replace function public.pvp_tournament_maybe_advance(p_tournament_id uuid, p_round integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_completed integer;
  v_final_match public.pvp_tournament_matches;
  v_secret text;
begin
  select count(*), count(*) filter (where status = 'completed')
  into v_total, v_completed
  from public.pvp_tournament_matches
  where tournament_id = p_tournament_id and round = p_round;

  if v_total = 0 or v_completed < v_total then
    return;
  end if;

  if v_total = 1 then
    select * into v_final_match from public.pvp_tournament_matches
    where tournament_id = p_tournament_id and round = p_round;

    update public.pvp_tournaments
    set status = 'completed',
        winner_character_id = v_final_match.winner_character_id,
        winner_name = case when v_final_match.winner_character_id = v_final_match.character_a_id
          then v_final_match.character_a_name else v_final_match.character_b_name end,
        champion_title = 'Top Hunter',
        updated_at = now()
    where id = p_tournament_id;

    perform public.ensure_pvp_tournament_registration_open();
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_push_secret';
  if v_secret is null then
    return; -- same silent-no-op convention as notify_lucky_ticket_ready
  end if;

  perform net.http_post(
    url := 'https://bwyegfyvrcfchonzvffo.supabase.co/functions/v1/pvp-tournament-advance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_I11RHUV-HUDIrK_N4CivEg_6Ci7wCoQ',
      'X-Cron-Secret', v_secret
    ),
    body := jsonb_build_object('tournament_id', p_tournament_id, 'round', p_round + 1)
  );
end;
$$;

revoke all on function public.pvp_tournament_maybe_advance(uuid, integer) from public;
grant execute on function public.pvp_tournament_maybe_advance(uuid, integer) to service_role;

-- ============================================================================
-- 5) One-off data fix: Ethan (204cf5e1-f138-4c6e-8a22-5c6d344f31d1) never
-- opened the Round 2 final against Huntard (1b97baa0-f1c5-4f17-990e-
-- c817fed2175a) in the live 2026-09-05 tournament (94548f18-9584-4228-
-- b862-49d90ee32208, duel 8c344fbd-0375-4b0b-aa18-48b7beaf14fb) -- its
-- turn_deadline expired with nobody's client ever reopening it to trigger
-- the lazy forfeit check (fixed going forward by the sweep above). Manually
-- applies the exact same forfeit-and-record path the sweep would have taken:
-- Ethan forfeits, Huntard is crowned tournament champion ("Top Hunter") --
-- this is also this tournament's final match, so pvp_tournament_maybe_advance
-- finalizes the tournament immediately and opens next week's registration
-- (already existed as ebad87b5, from the bug being fixed above).
-- ============================================================================
update public.pvp_duels
set status = 'forfeited', turn_deadline = null, updated_at = now(),
    winner_character_id = '1b97baa0-f1c5-4f17-990e-c817fed2175a'
where id = '8c344fbd-0375-4b0b-aa18-48b7beaf14fb'
  and status = 'active'
  and current_turn_character_id = '204cf5e1-f138-4c6e-8a22-5c6d344f31d1';

select public.pvp_tournament_record_duel_result(
  '8c344fbd-0375-4b0b-aa18-48b7beaf14fb',
  '1b97baa0-f1c5-4f17-990e-c817fed2175a'
);

commit;
