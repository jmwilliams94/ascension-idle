-- Fix: resolve-combat permission errors on compute_max_durability (2026-11-18).
-- compute_max_durability() was locked down in 20260814000000 on the
-- assumption it'd only ever be called from security-definer functions
-- (which execute as the owner, so no explicit grant needed). The
-- 20261117010000 quiver-durability trigger (enforce_item_no_durability_concept,
-- fires before insert/update on item_instances) also calls it, and that
-- trigger runs as whichever role performed the DML -- for resolve-combat's
-- item_instances writes, that's resolve_combat_apply_results, which
-- 20260821060000 deliberately made non-security-definer (service-role-only
-- trust model). So the trigger executes as service_role, which never had an
-- explicit grant on compute_max_durability, causing "permission denied for
-- function compute_max_durability" on every kill that touches item_instances
-- (durability decay updates, item drop grants).
begin;

grant execute on function public.compute_max_durability(text, integer) to service_role;

commit;
