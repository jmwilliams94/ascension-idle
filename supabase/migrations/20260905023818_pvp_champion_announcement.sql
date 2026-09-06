-- Global announcement when a PvP Tournament champion is crowned (2026-09-05,
-- requested by the user, same day as the "Top Hunter" badge) -- fires from
-- pvp_tournament_maybe_advance's existing final-match branch, right where
-- champion_title is already set. Already security definer (see
-- 20261223000000_pvp_duel_no_show_timer_and_champion_title.sql), so no new
-- grant is needed -- same reasoning as every other security-definer writer of
-- global_announcements. New 'pvp_champion' kind, no CHECK constraint to widen.
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
  v_winner_name text;
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

    v_winner_name := case when v_final_match.winner_character_id = v_final_match.character_a_id
      then v_final_match.character_a_name else v_final_match.character_b_name end;

    update public.pvp_tournaments
    set status = 'completed',
        winner_character_id = v_final_match.winner_character_id,
        winner_name = v_winner_name,
        champion_title = 'Top Hunter',
        updated_at = now()
    where id = p_tournament_id;

    insert into public.global_announcements (kind, character_name, message)
    values ('pvp_champion', v_winner_name, v_winner_name || ' has been crowned the Top Hunter!');

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

-- Backfill: Huntard was already crowned this week's champion earlier today
-- (20261223000000's one-off fix), before this announcement existed -- insert
-- the announcement that would have fired, so it isn't silently missing from
-- Global Chat/the announcement history for the tournament's actual result.
insert into public.global_announcements (kind, character_name, message)
values ('pvp_champion', 'Huntard', 'Huntard has been crowned the Top Hunter!');
