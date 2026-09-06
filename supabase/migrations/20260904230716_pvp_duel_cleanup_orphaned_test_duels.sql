-- Cleanup, 2026-09-05: the user kept seeing an active "Wuxee vs Switchee"
-- duel on their PvP tab after the tournament self-match fix (v1.131.2) and
-- Hunter-only restriction (v1.131.3) -- unrelated to either. Root cause: 6
-- leftover 'active' pvp_duels rows (plus 4 'forfeited') from Phase 1/2 manual
-- dev testing on 2026-08-31, never linked to any pvp_tournament_matches row,
-- were never cleaned up. usePvpDuelStore.loadActiveDuel() picks the most
-- recent 'active' row for a character with no awareness of "is this real" --
-- so Wuxee/Switchee (test characters used for that original testing) kept
-- surfacing one of these as a live duel indefinitely, regardless of the
-- tournament bracket being fixed.
--
-- Deletes every pvp_duels row NOT referenced by any pvp_tournament_matches
-- row -- the two real, tournament-linked duels (Switchee/Wuxee round 1,
-- Switchee/Huntard round 2, both already 'completed') are untouched.
-- pvp_duel_secrets cascades on duel_id (confirmed FK ON DELETE CASCADE), so
-- no separate cleanup needed there.
begin;

delete from public.pvp_duels
where id not in (select duel_id from public.pvp_tournament_matches where duel_id is not null);

commit;
