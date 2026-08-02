-- Fixes achievement kill counts not being recorded at all, for both the
-- character and account ladders, in both live and offline/AFK play.
--
-- 20260801000000_add_achievements_and_pets.sql created character_monster_kills/
-- account_monster_kills/account_pets and granted select to `authenticated`
-- (for the client's own read-only cache), but never granted `service_role`
-- anything on them -- the exact same gotcha already fixed once before for
-- resolve-combat's other tables in 20260730050000_grant_service_role_table_
-- access.sql (see that file's own comment, and CLAUDE.md's Persistence
-- section's "migration gotcha" note). resolve-combat's service-role client
-- upserts into character_monster_kills/account_monster_kills and inserts into
-- account_pets on every kill -- without this grant, every one of those calls
-- has been silently failing with "permission denied for table" since the
-- achievements feature shipped (the calls are awaited without checking their
-- error, so nothing surfaced this beyond kill counts simply never moving).
grant all on public.character_monster_kills to service_role;
grant all on public.account_monster_kills to service_role;
grant all on public.account_pets to service_role;
