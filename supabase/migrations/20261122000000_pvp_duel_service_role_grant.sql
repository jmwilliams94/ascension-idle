-- Fix: pvp_duel_gather_state/pvp_duel_apply_action (both plain functions,
-- not SECURITY DEFINER -- see 20261121000000_pvp_duel_core.sql's own header
-- for why) run as whichever role calls them. resolve-pvp-duel's
-- service-role client calls them, but the original migration only granted
-- `select` on pvp_duels to `authenticated` -- never anything to
-- `service_role` on either table. RLS bypass and table-level GRANTs are two
-- separate permission layers in Postgres; service_role bypassing RLS
-- doesn't imply it has SELECT/INSERT/UPDATE/DELETE on a table at all. Same
-- root cause as root CLAUDE.md's documented gotcha (bit
-- global_announcements and compute_max_durability before this) --
-- reproduced live 2026-08-31 as "permission denied for table pvp_duels" on
-- every place_zone/guess call, confirmed via the Edge Function's log.
begin;

grant all on public.pvp_duels to service_role;
grant all on public.pvp_duel_secrets to service_role;

commit;
