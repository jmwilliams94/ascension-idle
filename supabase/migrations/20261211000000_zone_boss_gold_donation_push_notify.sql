-- Push notifications for the two other server events, plus granular
-- per-type opt-out (requested by the user): "notify me when a Zone Boss
-- spawns" and "notify me when a Gold Donation Event starts", each toggle-
-- able independently, and Lucky Lad's existing trigger retrofitted onto the
-- same preference system rather than being the one un-toggleable exception.
--
-- Both new events are, same as Lucky Lad, currently only advanced lazily
-- (ensure_world_boss_spawn/ensure_gold_donation_pool, called from client
-- mount or nested inside the attack/donate RPCs -- see CLAUDE.server-events.md).
-- That can't reach an offline player, so both new cron functions call the
-- existing idempotent ensure_* function themselves first (a one-line
-- `perform`, not a reimplementation of the roll-the-next-spawn/pool logic --
-- deliberately reused rather than copied a third/fourth time) before
-- checking eligibility. This has one real side effect worth flagging: the
-- world now also advances (a new spawn/pool rolls once its gap elapses)
-- even with nobody online to trigger it, every 5 minutes on the cron tick --
-- previously a fully idle server could sit "gap elapsed, nobody home to
-- roll it" indefinitely. Treated as a benign improvement (the world clock
-- now matches wall-clock time regardless of player presence), not a bug.
--
-- Race-safety: each new spawn/pool row gets its own `notified_at`
-- timestamptz (row-scoped, not per-account like Lucky Lad's -- "a boss
-- spawned" is one global event, not an account-specific cooldown), set
-- while that row is locked FOR UPDATE, so two overlapping cron ticks can't
-- both see "not yet notified" and double-send.
begin;

alter table public.world_boss_spawns add column if not exists notified_at timestamptz;
alter table public.gold_donation_pools add column if not exists notified_at timestamptz;

alter table public.players
  add column if not exists notify_zone_boss boolean not null default true,
  add column if not exists notify_gold_donation boolean not null default true,
  add column if not exists notify_lucky_ticket boolean not null default true;

-- ============================================================================
-- 1. Retrofit Lucky Lad's existing trigger onto the same opt-out column,
--    full body otherwise unchanged from 20261028000000.
-- ============================================================================
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

  select array_agg(p.id) into v_account_ids
  from public.players p
  where exists (select 1 from public.push_subscriptions ps where ps.account_id = p.id)
    and p.notify_lucky_ticket
    and now() >= coalesce(p.lucky_free_ticket_claimed_at, '-infinity'::timestamptz) + interval '4 hours'
    and (
      p.lucky_free_ticket_notified_at is null
      or p.lucky_free_ticket_notified_at < coalesce(p.lucky_free_ticket_claimed_at, '-infinity'::timestamptz)
    );

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
      'title', 'Lucky Lad',
      'body', 'You have a free Lucky Lad roll available!'
    )
  );

  update public.players
  set lucky_free_ticket_notified_at = now()
  where id = any(v_account_ids);
end;
$$;

-- ============================================================================
-- 2. Zone Boss spawn notification. "Just spawned" = notified_at is still
--    null on the current spawn row -- true for exactly one cron tick per
--    spawn, regardless of whether the boss is later killed/window-expires
--    before the next tick (this only guards the notification, not the
--    spawn's own lifecycle).
-- ============================================================================
create or replace function public.notify_zone_boss_spawned()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_spawn_id uuid;
  v_boss_id text;
  v_status text;
  v_notified_at timestamptz;
  v_boss_display_name text;
  v_account_ids uuid[];
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_push_secret';

  if v_secret is null then
    return;
  end if;

  -- Advance the world first, same call any client already makes on mount --
  -- see the migration header for why this is a one-line reuse, not new
  -- spawn-rolling logic.
  perform public.ensure_world_boss_spawn();

  select current_spawn_id into v_spawn_id from public.world_boss_state where id = 1;

  select boss_id, status, notified_at
  into v_boss_id, v_status, v_notified_at
  from public.world_boss_spawns
  where id = v_spawn_id
  for update;

  if v_spawn_id is null or v_notified_at is not null or v_status <> 'active' then
    return;
  end if;

  select array_agg(p.id) into v_account_ids
  from public.players p
  where exists (select 1 from public.push_subscriptions ps where ps.account_id = p.id)
    and p.notify_zone_boss;

  -- Marked notified regardless of whether anyone was eligible at this
  -- moment, so this spawn is never re-checked on a later tick even if
  -- nobody was subscribed yet.
  update public.world_boss_spawns set notified_at = now() where id = v_spawn_id;

  if v_account_ids is null or array_length(v_account_ids, 1) = 0 then
    return;
  end if;

  select display_name into v_boss_display_name from public.zone_boss_catalog() where boss_id = v_boss_id;
  v_boss_display_name := coalesce(v_boss_display_name, 'A Zone Boss');

  perform net.http_post(
    url := 'https://bwyegfyvrcfchonzvffo.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_I11RHUV-HUDIrK_N4CivEg_6Ci7wCoQ',
      'X-Cron-Secret', v_secret
    ),
    body := jsonb_build_object(
      'account_ids', to_jsonb(v_account_ids),
      'title', 'Zone Boss',
      'body', v_boss_display_name || ' has appeared! Fight for a share of the rewards.'
    )
  );
end;
$$;

-- ============================================================================
-- 3. Gold Donation Event start notification. "Just started" = a pool row in
--    'collecting' status with notified_at still null -- 'collecting' is
--    also the pool's steady state while donations accumulate below
--    threshold, but only a freshly-inserted row ever has notified_at null,
--    so this only fires once per pool regardless of how long collecting
--    continues.
-- ============================================================================
create or replace function public.notify_gold_donation_started()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_pool_id uuid;
  v_status text;
  v_notified_at timestamptz;
  v_target_amount bigint;
  v_account_ids uuid[];
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_push_secret';

  if v_secret is null then
    return;
  end if;

  perform public.ensure_gold_donation_pool();

  select current_pool_id into v_pool_id from public.gold_donation_state where id = 1;

  select status, notified_at, target_amount
  into v_status, v_notified_at, v_target_amount
  from public.gold_donation_pools
  where id = v_pool_id
  for update;

  if v_pool_id is null or v_notified_at is not null or v_status <> 'collecting' then
    return;
  end if;

  select array_agg(p.id) into v_account_ids
  from public.players p
  where exists (select 1 from public.push_subscriptions ps where ps.account_id = p.id)
    and p.notify_gold_donation;

  update public.gold_donation_pools set notified_at = now() where id = v_pool_id;

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
      'title', 'Gold Donation Event',
      'body', 'A new Gold Donation Event has started! Donate toward the ' || to_char(v_target_amount, 'FM999,999,999,999') || ' gold goal for a shared buff.'
    )
  );
end;
$$;

revoke all on function public.notify_zone_boss_spawned from public;
revoke all on function public.notify_gold_donation_started from public;

select cron.schedule(
  'notify-zone-boss-spawned',
  '*/5 * * * *',
  $$select public.notify_zone_boss_spawned();$$
);

select cron.schedule(
  'notify-gold-donation-started',
  '*/5 * * * *',
  $$select public.notify_gold_donation_started();$$
);

commit;
