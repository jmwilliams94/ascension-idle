-- Fixes a live regression from 20260901060000_room_check_excludes_listed_and_mailed.sql:
-- "permission denied for table marketplace_listings" breaking every combat
-- resolution (reported by the user via console errors).
--
-- Root cause: resolve_combat_gather_state is NOT security definer (it runs
-- as service_role, invoked directly by resolve-combat's service-role client
-- -- see its own `grant execute ... to service_role` at the bottom of its
-- definition). The room-check fix added `select ... from marketplace_listings`
-- / `select ... from mail` subqueries inside it, but neither table was ever
-- granted to service_role -- both were previously only ever touched from
-- inside owner-run SECURITY DEFINER RPCs (which bypass grants as the table
-- owner), per CLAUDE.marketplace-and-mail.md's own note that this was true
-- "as of" that doc. Same recurring gotcha CLAUDE.md already documents (bit
-- global_announcements before, and gold_donation_pools/gold_donation_state
-- needed the identical fix in 20260829000000_resolve_combat_active_gold_donation_event.sql
-- for the same reason: a plain, non-definer function reading a table for the
-- first time under the service_role connection).
grant select on public.marketplace_listings to service_role;
grant select on public.mail to service_role;
