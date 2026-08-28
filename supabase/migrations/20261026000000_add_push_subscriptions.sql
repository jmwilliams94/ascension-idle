-- Push subscription storage for Web Push notifications (groundwork only --
-- see CLAUDE.pwa-and-mobile.md's Push Notifications section). Account-scoped
-- (a browser/device subscription isn't a per-character mechanic) -- see
-- CLAUDE.md's cross-cutting gotcha about account-shared state never living
-- on characters. No real game event fires a push yet; this only backs the
-- Settings > Notifications toggle + "Send test notification" button and the
-- send-push Edge Function.
begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_account_id_idx on public.push_subscriptions (account_id);

alter table public.push_subscriptions enable row level security;

create policy "Players can view their own push subscriptions"
  on public.push_subscriptions for select
  using (auth.uid() = account_id);

create policy "Players can insert their own push subscriptions"
  on public.push_subscriptions for insert
  with check (auth.uid() = account_id);

create policy "Players can delete their own push subscriptions"
  on public.push_subscriptions for delete
  using (auth.uid() = account_id);

-- RLS alone doesn't grant table access (CLAUDE.md's grants gotcha) --
-- authenticated needs these explicit grants for the policies above to ever
-- apply, and service_role needs full access since send-push (Edge Function,
-- service-role client) reads every account's subscriptions and prunes dead
-- ones (410/404 Gone from the push service) after a failed send.
grant select, insert, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

commit;
