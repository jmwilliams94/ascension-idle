-- One-off data fix, companion to 20261215000000_pvp_duel_reenable_timer.sql:
-- today's (2026-09-04) Friday-noon-Brisbane weekly kickoff already fired at
-- 02:00 UTC under the disabled-timer bug -- one real bracket match (Huntard
-- vs Switchee) has been stuck at turn_number 0 for hours with no forfeit
-- possible, while the other slot (Wuxard) already auto-advanced past it on
-- a bye. Rather than let that broken bracket limp forward, this resets the
-- live tournament back to registration -- keeping its 3 existing
-- registrants plus whoever queued for next week in the meantime -- and
-- reschedules it for tomorrow (2026-09-05) at the same Friday-noon-Brisbane
-- kickoff time (02:00 UTC), now with the timer fix in place. A fresh bracket
-- reshuffle tomorrow means nobody keeps the unearned bye/advantage from the
-- broken run.
--
-- The standing pvp-tournament-kickoff cron only fires Fridays
-- (0 2 * * 5) -- tomorrow is a Saturday, so a second, one-time cron entry is
-- added for just that day (day-of-month 5, month 9 pins it to 2026-09-05;
-- it unschedules itself as its last statement so it doesn't linger as a
-- recurring "every Sept 5" job in future years).
begin;

with target as (
  select id from public.pvp_tournaments where status = 'live' limit 1
), pending as (
  select id from public.pvp_tournaments where status = 'registration' limit 1
), moved_registrations as (
  insert into public.pvp_tournament_registrations (tournament_id, character_id, character_name, registered_at)
  select (select id from target), r.character_id, r.character_name, r.registered_at
  from public.pvp_tournament_registrations r, pending
  where r.tournament_id = (select id from pending)
  on conflict (tournament_id, character_id) do nothing
  returning 1
), removed_matches as (
  delete from public.pvp_tournament_matches
  where tournament_id = (select id from target)
  returning duel_id
), removed_duels as (
  delete from public.pvp_duels
  where id in (select duel_id from removed_matches where duel_id is not null)
  returning 1
), removed_pending_tournament as (
  delete from public.pvp_tournaments
  where id = (select id from pending)
  returning 1
)
update public.pvp_tournaments
set status = 'registration',
    event_starts_at = '2026-09-05 02:00:00+00',
    updated_at = now()
where id = (select id from target);

select cron.schedule(
  'pvp-tournament-makeup-kickoff',
  '0 2 5 9 *', -- one-time: 2026-09-05 02:00 UTC = Saturday 12:00 Brisbane
  $$select public.pvp_tournament_kickoff_if_due(); select cron.unschedule('pvp-tournament-makeup-kickoff');$$
);

commit;
