-- First real push-notification trigger (2026-08-28, requested by the user):
-- "You have a free Lucky Lad roll available!" -- see CLAUDE.pwa-and-mobile.md's
-- Push Notifications section for the send/receive pipeline this hooks into.
-- This is the first pg_cron/pg_net usage anywhere in this project -- every
-- other server event previously only advanced lazily when some player's
-- client happened to call the relevant RPC (see CLAUDE.server-events.md),
-- which can't reach a genuinely offline player. The free-ticket cooldown is
-- account-wide (players.lucky_free_ticket_claimed_at, 4 hours -- see
-- CLAUDE.md's cross-cutting gotcha for why it moved off characters), so this
-- can only ever fire once per account per cooldown window regardless of how
-- many characters that account has -- no per-character name is referenced.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.players
  add column if not exists lucky_free_ticket_notified_at timestamptz;

-- The actual secret value is NOT in this file, or in any committed file --
-- it was inserted once via `supabase db query "select vault.create_secret(...)"
-- --linked` (see the send-push Edge Function's own comment for the matching
-- CRON_PUSH_SECRET env var). Re-running this migration on a project that
-- hasn't had that one-off command run will leave this function as a silent
-- no-op (the null-secret guard below) rather than erroring.
create or replace function public.notify_lucky_ticket_ready()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_account_ids uuid[];
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_push_secret';

  if v_secret is null then
    return;
  end if;

  -- Ready = the 4h cooldown has elapsed since the last claim (or never
  -- claimed at all, coalesced to -infinity so a brand-new account is
  -- immediately eligible). Not-yet-notified = we haven't already pushed for
  -- *this* claim cycle -- comparing against the same coalesced anchor means
  -- a fresh claim (which bumps lucky_free_ticket_claimed_at forward) always
  -- re-arms this for the next cycle without any separate reset step.
  select array_agg(p.id) into v_account_ids
  from public.players p
  where exists (select 1 from public.push_subscriptions ps where ps.account_id = p.id)
    and now() >= coalesce(p.lucky_free_ticket_claimed_at, '-infinity'::timestamptz) + interval '4 hours'
    and (
      p.lucky_free_ticket_notified_at is null
      or p.lucky_free_ticket_notified_at < coalesce(p.lucky_free_ticket_claimed_at, '-infinity'::timestamptz)
    );

  if v_account_ids is null or array_length(v_account_ids, 1) = 0 then
    return;
  end if;

  -- net.http_post is fire-and-forget from Postgres's perspective (pg_net
  -- queues it, a background worker sends it, the response lands in
  -- net._http_response later) -- notified_at is set optimistically right
  -- after enqueuing rather than waiting on the real result. Acceptable for
  -- a low-stakes reminder: a rare transient failure just means the next
  -- claim-then-4h cycle re-arms it again, same as send-push's own per-
  -- subscription failures are left for the next real send rather than
  -- retried inline.
  perform net.http_post(
    url := 'https://bwyegfyvrcfchonzvffo.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Public anon/publishable key, not a secret -- same value every
      -- client already ships (VITE_SUPABASE_ANON_KEY), needed for Kong's
      -- request routing since --no-verify-jwt only relaxes JWT validation.
      'apikey', 'sb_publishable_I11RHUV-HUDIrK_N4CivEg_6Ci7wCoQ',
      'X-Cron-Secret', v_secret
    ),
    body := jsonb_build_object(
      'account_ids', to_jsonb(v_account_ids),
      'title', 'Lucky Lad',
      'body', 'You have a free Lucky Lad roll available!'
    )
  );

  update public.players
  set lucky_free_ticket_notified_at = now()
  where id = any(v_account_ids);
end;
$$;

revoke all on function public.notify_lucky_ticket_ready from public;

select cron.schedule(
  'notify-lucky-ticket-ready',
  '*/15 * * * *',
  $$select public.notify_lucky_ticket_ready();$$
);

commit;
