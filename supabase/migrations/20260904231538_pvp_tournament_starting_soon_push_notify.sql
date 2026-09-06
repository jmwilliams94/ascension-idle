-- PvP Tournament "starts in 1 hour" push reminder (2026-09-05, requested by
-- the user) -- same shape as notify_zone_boss_spawned/
-- notify_gold_donation_started (20261211000000_zone_boss_gold_donation_push_notify.sql):
-- a row-scoped notified_at guard (fires once per tournament, never re-checked
-- once set) plus its own players.notify_* opt-out column, on the same
-- */5 * * * * cron cadence as the other two event reminders.
--
-- "1 hour out" = event_starts_at <= now() + interval '1 hour' on a
-- still-'registration' tournament -- true from the first cron tick inside
-- that window through kickoff, but notified_at makes it a one-shot per
-- tournament regardless of how many ticks land inside the window.
begin;

alter table public.pvp_tournaments add column if not exists starting_soon_notified_at timestamptz;

alter table public.players
  add column if not exists notify_pvp_tournament boolean not null default true;

create or replace function public.notify_pvp_tournament_starting_soon()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_tournament_id uuid;
  v_account_ids uuid[];
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_push_secret';

  if v_secret is null then
    return;
  end if;

  select id into v_tournament_id
  from public.pvp_tournaments
  where status = 'registration'
    and event_starts_at <= now() + interval '1 hour'
    and starting_soon_notified_at is null
  order by event_starts_at asc
  limit 1
  for update;

  if v_tournament_id is null then
    return;
  end if;

  select array_agg(p.id) into v_account_ids
  from public.players p
  where exists (select 1 from public.push_subscriptions ps where ps.account_id = p.id)
    and p.notify_pvp_tournament;

  -- Marked notified regardless of whether anyone was eligible at this
  -- moment, same convention as the other two event reminders -- this
  -- tournament is never re-checked on a later tick even if nobody was
  -- subscribed yet.
  update public.pvp_tournaments set starting_soon_notified_at = now() where id = v_tournament_id;

  if v_account_ids is null or array_length(v_account_ids, 1) = 0 then
    return;
  end if;

  perform net.http_post(
    url := 'https://bwyegfyvrcfchonzvffo.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_I11RHUV-HUDIrK_N4CivEg_6Ci7wCoQ',
      'X-Cron-Secret', v_secret
    ),
    body := jsonb_build_object(
      'account_ids', to_jsonb(v_account_ids),
      'title', 'PvP Tournament',
      'body', 'Weekly Top Hunter Event starts in 1 hour!'
    )
  );
end;
$$;

revoke all on function public.notify_pvp_tournament_starting_soon from public;

select cron.schedule(
  'notify-pvp-tournament-starting-soon',
  '*/5 * * * *',
  $$select public.notify_pvp_tournament_starting_soon();$$
);

commit;
