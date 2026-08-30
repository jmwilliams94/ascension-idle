-- Bug fix: zone_boss_catalog() was only ever granted implicitly to its owner
-- (postgres) -- the 20261113000000_zone_boss_rotation.sql migration assumed
-- "revoke from public, still callable by an owner-context caller" (the same
-- pattern world_boss_reward_for_tier uses), which only holds for a SECURITY
-- DEFINER caller running as its owner. ensure_world_boss_spawn (SECURITY
-- DEFINER) is fine. apply_world_boss_attack is a *plain* function invoked by
-- the world-boss-attack Edge Function's service-role client, so it executes
-- with service_role's own privileges -- and looks up the boss's display name
-- via zone_boss_catalog() on the killing blow (building the reward mail).
-- Without this grant, every attack that would actually finish off a boss
-- fails with "permission denied for function zone_boss_catalog" and rolls
-- back entirely (reported by the user as Zone Boss attacks intermittently
-- failing) -- since this has been broken since the rotation shipped
-- (2026-11-13), no boss has ever actually been killed by a real hit; every
-- payout so far went through ensure_world_boss_spawn's window-expiry
-- fallback instead (SECURITY DEFINER, unaffected). Same family of mistake as
-- the ensure_world_boss_spawn service_role grant bug fixed in
-- 20260826010000 and the global_announcements table-grant miss -- see
-- CLAUDE.md's grants gotcha.
begin;

grant execute on function public.zone_boss_catalog() to service_role;

commit;
