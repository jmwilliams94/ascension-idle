-- Fix: bug_reports' "Admin can view all bug reports" SELECT policy queried
-- auth.users directly inside its USING clause. A plain RLS policy predicate
-- runs under the *querying* role's own privileges (authenticated here), not
-- the migration author's -- and `authenticated` has no SELECT grant on
-- auth.users in this project (confirmed via has_table_privilege), unlike
-- every other admin check in this codebase, which lives inside a
-- SECURITY DEFINER function (admin_send_mail, submit_bug_report, etc.) and
-- so runs with the function owner's elevated privileges instead.
--
-- Net effect: any bug_reports row not already covered by the "own reports"
-- policy made Postgres attempt to evaluate this second policy, which threw
-- a permission-denied error instead of just evaluating false -- so the
-- admin's own "select every report" query never succeeded at all, and
-- BugReportPanel.tsx's Admin Queue section hung on "Loading..." forever
-- (loadAllReports's error branch never sets allReportsLoaded).
--
-- Fix: move the auth.users lookup into a SECURITY DEFINER helper function
-- (same trick every admin_* RPC in this project already relies on) and
-- reference that from the policy instead of querying auth.users inline.
begin;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() = (select id from auth.users where email = 'jmwilliams94@icloud.com');
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Admin can view all bug reports" on public.bug_reports;
create policy "Admin can view all bug reports"
  on public.bug_reports for select
  using (public.is_admin());

commit;
