-- Gold Donation Event server event (2026-08-28) — see CLAUDE.server-events.md
-- for the full confirmed design. Second cross-player shared event after
-- World Boss: a shared Gold pool donated to per-character, rerolled 50M-100M
-- each cycle. Crossing the threshold rolls a random buff (1 of 5 categories
-- x a x2-5 multiplier) for a random 30-60 minute window, then a silent
-- random 1-6h gap (same mechanic as World Boss's own dead gap, added in
-- 20260827000000_world_boss_dead_gap.sql) before the next pool opens.
--
-- This migration is schema + lifecycle RPCs only — donate_gold works and the
-- pool/buff state is real, but nothing reads the active buff into combat or
-- Forge rolls yet (that's a separate follow-up migration, since it touches
-- the already-duplicated resolve-combat math). The feature is inert/dormant
-- client-side until the frontend build-out step mounts a UI for it.
--
-- No cron, same lazy-trigger pattern as ensure_world_boss_spawn:
-- ensure_gold_donation_pool() is called on client mount and nested inside
-- donate_gold before it validates anything.
--
-- Unlike World Boss's attack, a donation has no derived combat-stat math to
-- duplicate in Deno — donate_gold is a pure gold debit + counter increment,
-- so it's a plain SECURITY DEFINER SQL RPC callable directly from the
-- client, no Edge Function needed.
begin;

-- ============================================================================
-- 1. Schema
-- ============================================================================

create table public.gold_donation_pools (
  id uuid primary key default gen_random_uuid(),
  target_amount bigint not null,
  total_donated bigint not null default 0,
  status text not null default 'collecting' check (status in ('collecting', 'active', 'ended')),
  buff_category text check (buff_category in ('exp', 'socket_unlock', 'comet', 'fallen_star', 'quality_tier')),
  buff_multiplier numeric(4, 2),
  buff_started_at timestamptz,
  buff_ends_at timestamptz,
  rewards_distributed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.gold_donation_pools enable row level security;

create policy "Gold donation pools are publicly viewable"
  on public.gold_donation_pools for select using (true);

grant select on public.gold_donation_pools to authenticated;
-- No insert/update grant to any client role — written only inside
-- ensure_gold_donation_pool/donate_gold, both SECURITY DEFINER.

alter publication supabase_realtime add table public.gold_donation_pools;

create table public.gold_donation_participants (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.gold_donation_pools(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  total_donated bigint not null default 0,
  last_donated_at timestamptz,
  unique (pool_id, character_id)
);

alter table public.gold_donation_participants enable row level security;

create policy "Characters can view their own gold donation participation"
  on public.gold_donation_participants for select
  using (exists (
    select 1 from public.characters c
    where c.id = gold_donation_participants.character_id and c.account_id = auth.uid()
  ));

grant select on public.gold_donation_participants to authenticated;
-- Leaderboard reads through get_gold_donation_leaderboard (SECURITY
-- DEFINER, below), not this table directly — same safe-public-snapshot
-- reasoning as get_world_boss_leaderboard.

-- Internal singleton pointer — never granted to anon/authenticated, no RLS
-- policy at all, same shape as world_boss_state. A client never reads this
-- table directly; it reads gold_donation_pools instead.
create table public.gold_donation_state (
  id integer primary key check (id = 1),
  current_pool_id uuid not null references public.gold_donation_pools(id),
  next_pool_at timestamptz
);

alter table public.gold_donation_state enable row level security;

-- Seed: one starter collecting pool (threshold rolled 50M-100M) + the
-- singleton pointing at it, so the feature is live immediately on deploy.
do $$
declare
  v_pool_id uuid;
begin
  insert into public.gold_donation_pools (target_amount, total_donated, status)
  values ((50000000 + floor(random() * 50000001))::bigint, 0, 'collecting')
  returning id into v_pool_id;

  insert into public.gold_donation_state (id, current_pool_id) values (1, v_pool_id);
end $$;

-- No service_role table grants needed — unlike World Boss, nothing here is a
-- plain function invoked via a service-role Edge Function client; both
-- ensure_gold_donation_pool and donate_gold are SECURITY DEFINER, so they
-- run with their owner's table privileges regardless of the calling role.

-- ============================================================================
-- 2. mail: widen reason check for gold donation rewards. currency_type
--    already supports 'gold' (added for World Boss), no change needed there.
-- ============================================================================
alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in ('purchase', 'listing_cancelled', 'listing_expired', 'admin_gift', 'bug_report_reward', 'suggestion_reward', 'world_boss_reward', 'gold_donation_reward'));

-- ============================================================================
-- 3. gold_donation_reward_for_tier — placeholder reward table, same
--    swap-via-create-or-replace mechanism as world_boss_reward_for_tier.
--    Smaller amounts than World Boss's since donating is a passive top-up,
--    not a skill/AP-gated action — not a final balance figure.
-- ============================================================================
create or replace function public.gold_donation_reward_for_tier(p_tier text)
returns table (currency_type text, amount integer)
language sql
stable
as $$
  select t.currency_type, t.amount from (values
    ('participation', 'gold', 500),
    ('third', 'gold', 5000),
    ('second', 'gold', 10000),
    ('first', 'gold', 20000),
    ('first', 'ascension_points', 5)
  ) as t(tier, currency_type, amount)
  where t.tier = p_tier;
$$;

revoke all on function public.gold_donation_reward_for_tier(text) from public;

-- ============================================================================
-- 4. ensure_gold_donation_pool — the lazy lifecycle-transition entry point.
--    Four-way branch: collecting (fast path) -> active-with-buff-running
--    (fast path) -> active-with-buff-expired (payout, mark ended, start the
--    gap) -> ended-with-gap-elapsed (roll a fresh pool). The
--    'collecting'->'active' transition does NOT happen here — that's rolled
--    inline inside donate_gold, on the exact donation that crosses the
--    threshold, since this function has no reason to run on every donation.
-- ============================================================================
create or replace function public.ensure_gold_donation_pool()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool_id uuid;
  v_next_pool_at timestamptz;
  v_status text;
  v_buff_ends_at timestamptz;
  v_new_pool_id uuid;
  v_target bigint;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_reward record;
  v_message text;
begin
  -- Global mutex, same accepted-brief-lock-hold reasoning as
  -- ensure_world_boss_spawn's world_boss_state lock.
  select current_pool_id, next_pool_at into v_pool_id, v_next_pool_at
  from public.gold_donation_state where id = 1 for update;

  select status, buff_ends_at into v_status, v_buff_ends_at
  from public.gold_donation_pools where id = v_pool_id;

  if v_status = 'collecting' then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' and now() < v_buff_ends_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' then
    -- Buff window just expired under this caller's watch — pay out and
    -- start the gap, same "second caller only sees the result" idempotency
    -- as ensure_world_boss_spawn.
    for v_participant in
      select character_id, total_donated, row_number() over (order by total_donated desc) as rn
      from public.gold_donation_participants
      where pool_id = v_pool_id
    loop
      v_message := case v_participant.rn
        when 1 then 'You were the top donor in the Gold Donation Event!'
        when 2 then 'You placed 2nd in the Gold Donation Event!'
        when 3 then 'You placed 3rd in the Gold Donation Event!'
        else 'Thanks for donating to the Gold Donation Event!'
      end;

      for v_reward in select * from public.gold_donation_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
      end loop;

      if v_participant.rn <= 3 then
        for v_reward in
          select * from public.gold_donation_reward_for_tier(
            case v_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.gold_donation_pools set status = 'ended', rewards_distributed_at = now() where id = v_pool_id;
    update public.gold_donation_state set next_pool_at = now() + (interval '1 hour' * (1 + random() * 5)) where id = 1;

    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  -- status = 'ended': gap in progress, or gap just elapsed.
  if v_next_pool_at is null or now() < v_next_pool_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  v_target := (50000000 + floor(random() * 50000001))::bigint;
  insert into public.gold_donation_pools (target_amount, total_donated, status)
  values (v_target, 0, 'collecting')
  returning id into v_new_pool_id;

  update public.gold_donation_state set current_pool_id = v_new_pool_id, next_pool_at = null where id = 1;

  return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_new_pool_id));
end;
$$;

revoke all on function public.ensure_gold_donation_pool() from public;
grant execute on function public.ensure_gold_donation_pool() to authenticated;

-- ============================================================================
-- 5. donate_gold — the sole authoritative write path. SECURITY DEFINER, so
--    it runs with its owner's table privileges (no service_role grants
--    needed on characters/gold_donation_*, unlike World Boss's plain,
--    service-role-invoked apply_world_boss_attack). Lock order: characters
--    row first (ownership + balance), then the pool row (status +
--    threshold) — consistent with this project's "characters locked before
--    any other row" convention (sell_item, create_marketplace_listing,
--    draw_lucky_ticket).
-- ============================================================================
create or replace function public.donate_gold(p_character_id uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_gold bigint;
  v_pool_id uuid;
  v_status text;
  v_target_amount bigint;
  v_pool_total bigint;
  v_participant_total bigint;
  v_category text;
  v_multiplier numeric;
  v_duration_minutes integer;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- Lazy lifecycle trigger first — mirrors apply_world_boss_attack calling
  -- ensure_world_boss_spawn() before validating anything.
  perform public.ensure_gold_donation_pool();

  select account_id, gold into v_account_id, v_gold
  from public.characters where id = p_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_gold < p_amount then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'gold', v_gold);
  end if;

  select current_pool_id into v_pool_id from public.gold_donation_state where id = 1;

  select status, target_amount into v_status, v_target_amount
  from public.gold_donation_pools where id = v_pool_id for update;

  if v_status <> 'collecting' then
    return jsonb_build_object('ok', false, 'error', 'pool_not_collecting');
  end if;

  update public.characters set gold = gold - p_amount where id = p_character_id
  returning gold into v_gold;

  insert into public.gold_donation_participants (pool_id, character_id)
  values (v_pool_id, p_character_id)
  on conflict (pool_id, character_id) do nothing;

  update public.gold_donation_participants
  set total_donated = total_donated + p_amount, last_donated_at = now()
  where pool_id = v_pool_id and character_id = p_character_id
  returning total_donated into v_participant_total;

  update public.gold_donation_pools
  set total_donated = total_donated + p_amount
  where id = v_pool_id
  returning total_donated into v_pool_total;

  -- Buff rolled inline, on the exact donation that crosses the threshold.
  -- Safe against double-rolling: the pool row has been FOR UPDATE-locked
  -- since before this donation's own gold debit, so no concurrent
  -- donate_gold call against the same pool can be mid-flight — Postgres
  -- blocks a second caller's own FOR UPDATE on this row until this
  -- transaction commits, at which point v_status will already read 'active'
  -- for them.
  if v_pool_total >= v_target_amount then
    v_category := (array['exp', 'socket_unlock', 'comet', 'fallen_star', 'quality_tier'])[1 + floor(random() * 5)::int];
    v_multiplier := round((2 + random() * 3)::numeric, 2); -- x2.00-x5.00, uniform, even weighting
    v_duration_minutes := 30 + floor(random() * 31)::int; -- 30-60 inclusive, whole-minute increments

    update public.gold_donation_pools
    set status = 'active',
        buff_category = v_category,
        buff_multiplier = v_multiplier,
        buff_started_at = now(),
        buff_ends_at = now() + (v_duration_minutes || ' minutes')::interval
    where id = v_pool_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'gold_remaining', v_gold,
    'pool_total_donated', v_pool_total,
    'pool_target', v_target_amount,
    'triggered_buff', v_pool_total >= v_target_amount,
    'participant_total_donated', v_participant_total
  );
end;
$$;

revoke all on function public.donate_gold(uuid, integer) from public;
grant execute on function public.donate_gold(uuid, integer) to authenticated;

-- ============================================================================
-- 6. get_gold_donation_leaderboard — safe public snapshot RPC, same
--    precedent as get_world_boss_leaderboard.
-- ============================================================================
create or replace function public.get_gold_donation_leaderboard(p_character_id uuid default null, p_pool_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool_id uuid;
  v_entries jsonb;
  v_self jsonb;
begin
  v_pool_id := coalesce(p_pool_id, (select current_pool_id from public.gold_donation_state where id = 1));

  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', ranked.rn,
    'character_name', c.name,
    'total_donated', ranked.total_donated
  ) order by ranked.rn), '[]'::jsonb)
  into v_entries
  from (
    select character_id, total_donated, row_number() over (order by total_donated desc) as rn
    from public.gold_donation_participants
    where pool_id = v_pool_id
    order by total_donated desc
    limit 50
  ) ranked
  join public.characters c on c.id = ranked.character_id;

  if p_character_id is not null then
    select jsonb_build_object('rank', ranked.rn, 'total_donated', ranked.total_donated)
    into v_self
    from (
      select character_id, total_donated, row_number() over (order by total_donated desc) as rn
      from public.gold_donation_participants
      where pool_id = v_pool_id
    ) ranked
    where ranked.character_id = p_character_id;
  end if;

  return jsonb_build_object('ok', true, 'pool_id', v_pool_id, 'entries', v_entries, 'self', v_self);
end;
$$;

revoke all on function public.get_gold_donation_leaderboard(uuid, uuid) from public;
grant execute on function public.get_gold_donation_leaderboard(uuid, uuid) to authenticated;

commit;
