-- Fix (reported by the user, 2026-08-28): enabling push notifications failed
-- with a generic error immediately after the browser's own permission
-- prompt was granted. useNotificationStore.ts's enable() upserts the new
-- subscription via `.upsert(row, { onConflict: 'endpoint' })`, which
-- PostgREST/Postgres compiles to `insert ... on conflict (endpoint) do
-- update set ...` -- Postgres checks UPDATE privilege on the whole statement
-- at parse time, REGARDLESS of whether a conflict actually occurs at
-- runtime. 20261026000000_add_push_subscriptions.sql only granted
-- select/insert/delete and only wrote select/insert/delete RLS policies --
-- missing update on both counts, so even a brand-new, non-conflicting
-- subscription row failed to insert. Same family of mistake as CLAUDE.md's
-- grants gotcha, just triggered by an upsert's implicit ON CONFLICT DO
-- UPDATE branch rather than an explicit update statement.
begin;

create policy "Players can update their own push subscriptions"
  on public.push_subscriptions for update
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

grant update on public.push_subscriptions to authenticated;

commit;
