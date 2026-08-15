-- World Boss server event (2026-08-26) — see CLAUDE.combat-and-loot.md and
-- plan tranquil-knitting-acorn for the full design writeup. First genuinely
-- cross-player shared object in this game (one HP pool every character
-- damages), plus a competitive leaderboard and a mailed payout at the end of
-- each spawn's window.
--
-- Lifecycle: a spawn is attackable for one continuous random 6-8h window
-- (window_ends_at rolled fresh at insert). At window end, rewards mail out
-- to every participant (+ 1st/2nd/3rd bonuses) and the next spawn begins
-- immediately — back-to-back, no gap. If HP hits 0 before the window ends,
-- apply_world_boss_attack refuses further attacks, but the window still runs
-- its full course before payout (dead-but-awaiting-payout is a valid state).
--
-- No cron exists anywhere in this project — every lifecycle transition here
-- is lazily triggered by whichever client happens to call
-- ensure_world_boss_spawn next (on mount, or nested inside
-- apply_world_boss_attack itself), same lazy-expiry pattern marketplace
-- listing expiry already uses.
--
-- Damage itself is computed in a new sibling Edge Function
-- (world-boss-attack), not here — see that file's own header for why (real
-- equipment-derived combat stats are already duplicated once, client TS ->
-- resolve-combat's Deno copy; re-deriving a third time in plpgsql would be a
-- worse duplication than copying the Deno helpers a second time). This
-- migration only holds the schema + the gather/apply/leaderboard/lifecycle
-- RPCs the Edge Function and client call.
begin;

-- ============================================================================
-- 1. Schema
-- ============================================================================

create table public.world_boss_spawns (
  id uuid primary key default gen_random_uuid(),
  max_hp bigint not null,
  current_hp bigint not null,
  window_started_at timestamptz not null default now(),
  window_ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  rewards_distributed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.world_boss_spawns enable row level security;

create policy "World boss spawns are publicly viewable"
  on public.world_boss_spawns for select using (true);

grant select on public.world_boss_spawns to authenticated;
-- No insert/update grant to any client role — written only inside
-- ensure_world_boss_spawn (SECURITY DEFINER) and apply_world_boss_attack
-- (service_role, see the grants block below).

alter publication supabase_realtime add table public.world_boss_spawns;

create table public.world_boss_participants (
  id uuid primary key default gen_random_uuid(),
  spawn_id uuid not null references public.world_boss_spawns(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  free_attempts_used integer not null default 0,
  paid_attempts_used integer not null default 0,
  last_attempt_at timestamptz,
  total_damage bigint not null default 0,
  unique (spawn_id, character_id)
);

alter table public.world_boss_participants enable row level security;

create policy "Characters can view their own world boss participation"
  on public.world_boss_participants for select
  using (exists (
    select 1 from public.characters c
    where c.id = world_boss_participants.character_id and c.account_id = auth.uid()
  ));

grant select on public.world_boss_participants to authenticated;
-- No insert/update grant — written only inside apply_world_boss_attack. The
-- leaderboard reads through get_world_boss_leaderboard (SECURITY DEFINER,
-- below), not this table directly — the RLS policy above only lets a client
-- see their own characters' rows, same "safe public snapshot RPC instead of
-- widened RLS" reasoning as view_character_loadout.

-- Internal singleton pointer — never granted to anon/authenticated and no
-- RLS policy at all. A client never reads this table directly; it reads
-- world_boss_spawns instead. Only ever touched inside SECURITY
-- DEFINER/service-role functions.
create table public.world_boss_state (
  id integer primary key check (id = 1),
  current_spawn_id uuid not null references public.world_boss_spawns(id)
);

alter table public.world_boss_state enable row level security;

-- Seed: one starter spawn + the singleton pointing at it, so the feature is
-- live immediately on deploy with no manual bootstrap step. HP is a
-- PLACEHOLDER balance number (needs to comfortably survive many players'
-- worth of attempts across a 6-8h window without being trivial or
-- unreachable) — same disclosed-not-final status as every other economy
-- number in this game.
do $$
declare
  v_spawn_id uuid;
begin
  insert into public.world_boss_spawns (max_hp, current_hp, window_started_at, window_ends_at)
  values (2000000, 2000000, now(), now() + (interval '1 hour' * (6 + random() * 2)))
  returning id into v_spawn_id;

  insert into public.world_boss_state (id, current_spawn_id) values (1, v_spawn_id);
end $$;

-- ============================================================================
-- 2. Grants — the load-bearing gotcha (see CLAUDE.md's grants note): a NEW
--    table needs its own explicit grant regardless of RLS, and a new
--    NON-SECURITY-DEFINER writer of an EXISTING table needs its own grant
--    too, even if that table already has other (SECURITY DEFINER) writers
--    that never needed one. world_boss_gather_attack_state and
--    apply_world_boss_attack below are plain functions invoked via the
--    world-boss-attack Edge Function's service-role client — this exact
--    scenario bit global_announcements for real (see
--    20260825020000_grant_global_announcements_insert_service_role.sql).
-- ============================================================================
grant all on public.world_boss_spawns to service_role;
grant all on public.world_boss_participants to service_role;
grant all on public.world_boss_state to service_role;
-- `players` has never had an explicit service_role grant before — every
-- prior Ascension Points mutation went through a SECURITY DEFINER RPC (runs
-- as the function owner, no grant needed). apply_world_boss_attack is the
-- first plain/service_role writer of this table, so this is a genuinely new
-- grant, not a redundant one.
grant all on public.players to service_role;

-- ============================================================================
-- 3. mail: widen for world boss rewards. 'gold' is a new supported mail
--    currency_type — Marketplace/Shop gold proceeds go straight to
--    characters.gold and never flow through Mail, so this case never came up
--    before; a boss reward is the first Mail-delivered Gold grant.
-- ============================================================================
alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in ('purchase', 'listing_cancelled', 'listing_expired', 'admin_gift', 'bug_report_reward', 'suggestion_reward', 'world_boss_reward'));

alter table public.mail drop constraint if exists mail_currency_type_check;
alter table public.mail add constraint mail_currency_type_check
  check (currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll', 'lottery_ticket', 'ascension_points', 'gold'));

-- claim_mail: add the 'gold' branch (signature unchanged — safe to
-- create-or-replace, full body copied from 20260813110000_mail_history.sql
-- so every other currency branch/idempotency guard stays intact).
create or replace function public.claim_mail(p_character_id uuid, p_mail_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_mail_character_id uuid;
  v_item_id uuid;
  v_currency_type text;
  v_amount integer;
  v_claimed_at timestamptz;
  v_new_count integer;
  v_new_claimed_at timestamptz;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id, currency_type, amount, claimed_at
  into v_mail_character_id, v_item_id, v_currency_type, v_amount, v_claimed_at
  from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  if v_claimed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  v_amount := coalesce(v_amount, 1);

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + v_amount where id = p_character_id returning comet_count into v_new_count;
    elsif v_currency_type = 'fallen_star' then
      update public.characters set fallen_star_count = fallen_star_count + v_amount where id = p_character_id returning fallen_star_count into v_new_count;
    elsif v_currency_type = 'comet_scroll' then
      update public.characters set comet_scroll_count = comet_scroll_count + v_amount where id = p_character_id
      returning comet_scroll_count into v_new_count;
    elsif v_currency_type = 'fallen_star_scroll' then
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count + v_amount where id = p_character_id
      returning fallen_star_scroll_count into v_new_count;
    elsif v_currency_type = 'lottery_ticket' then
      update public.characters set lottery_ticket_count = lottery_ticket_count + v_amount where id = p_character_id
      returning lottery_ticket_count into v_new_count;
    elsif v_currency_type = 'gold' then
      update public.characters set gold = gold + v_amount where id = p_character_id returning gold into v_new_count;
    else -- 'ascension_points' -- account-wide, not a characters column
      update public.players set ascension_points = ascension_points + v_amount where id = v_account_id
      returning ascension_points into v_new_count;
    end if;

    update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

    return jsonb_build_object(
      'ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count, 'claimed_at', v_new_claimed_at
    );
  end if;

  update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

  return jsonb_build_object('ok', true, 'item_id', v_item_id, 'claimed_at', v_new_claimed_at);
end;
$$;

-- ============================================================================
-- 4. world_boss_reward_for_tier — placeholder reward table, keyed by tier.
--    Real amounts are undecided; the mechanism (swap via create-or-replace,
--    zero schema change) is final. Internal helper only, called from inside
--    ensure_world_boss_spawn — no grant needed for that (the SECURITY
--    DEFINER caller retains execute on its own owner's functions regardless
--    of a `revoke ... from public`), which we still do here for defense in
--    depth, matching this project's least-privilege convention.
-- ============================================================================
create or replace function public.world_boss_reward_for_tier(p_tier text)
returns table (currency_type text, amount integer)
language sql
stable
as $$
  select t.currency_type, t.amount from (values
    ('participation', 'gold', 250),
    ('third', 'gold', 1500),
    ('second', 'gold', 3000),
    ('first', 'gold', 6000),
    ('first', 'ascension_points', 10)
  ) as t(tier, currency_type, amount)
  where t.tier = p_tier;
$$;

revoke all on function public.world_boss_reward_for_tier(text) from public;

-- ============================================================================
-- 5. ensure_world_boss_spawn — the lazy lifecycle-transition entry point.
--    Called both on client mount (WorldBossConnection.tsx) and nested inside
--    apply_world_boss_attack, so a long-idle boss still advances the moment
--    anyone interacts with it at all. Idempotent under the world_boss_state
--    row lock: a second caller that races in after the transition already
--    ran just reads the freshly-rolled spawn as-is and returns immediately.
-- ============================================================================
create or replace function public.ensure_world_boss_spawn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_spawn_id uuid;
  v_status text;
  v_window_ends_at timestamptz;
  v_max_hp bigint;
  v_new_spawn_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_reward record;
  v_message text;
begin
  -- The global mutex — every concurrent caller (direct calls and the nested
  -- call from apply_world_boss_attack alike) serializes here. Lock hold time
  -- is brief (a handful of indexed lookups/inserts), so this is an accepted
  -- simplification rather than a real throughput concern given the 5-minute
  -- per-player attempt cooldown already caps how much real concurrency there
  -- is to serialize.
  select current_spawn_id into v_current_spawn_id from public.world_boss_state where id = 1 for update;

  select status, window_ends_at, max_hp into v_status, v_window_ends_at, v_max_hp
  from public.world_boss_spawns where id = v_current_spawn_id;

  if v_status = 'active' and now() < v_window_ends_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  if v_status = 'active' then
    -- Window just expired under this caller's watch — distribute rewards and
    -- end this spawn. A second caller that raced in behind the lock above
    -- only ever sees this branch's *result* (status already 'ended', or the
    -- next spawn already current), never re-enters it.
    for v_participant in
      select character_id, total_damage, row_number() over (order by total_damage desc) as rn
      from public.world_boss_participants
      where spawn_id = v_current_spawn_id and (free_attempts_used + paid_attempts_used) > 0
    loop
      v_message := case v_participant.rn
        when 1 then 'You placed 1st in the World Boss fight!'
        when 2 then 'You placed 2nd in the World Boss fight!'
        when 3 then 'You placed 3rd in the World Boss fight!'
        else 'Thanks for fighting the World Boss!'
      end;

      for v_reward in select * from public.world_boss_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
      end loop;

      if v_participant.rn <= 3 then
        for v_reward in
          select * from public.world_boss_reward_for_tier(
            case v_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.world_boss_spawns set status = 'ended', rewards_distributed_at = now() where id = v_current_spawn_id;
  end if;

  -- Roll the next spawn — fresh HP, a new random 6-8h window, starting the
  -- instant the old one's payout finished (no gap between cycles).
  v_max_hp := 2000000; -- PLACEHOLDER, same balance number as the seed above
  insert into public.world_boss_spawns (max_hp, current_hp, window_started_at, window_ends_at)
  values (v_max_hp, v_max_hp, now(), now() + (interval '1 hour' * (6 + random() * 2)))
  returning id into v_new_spawn_id;

  update public.world_boss_state set current_spawn_id = v_new_spawn_id where id = 1;

  return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_new_spawn_id));
end;
$$;

revoke all on function public.ensure_world_boss_spawn() from public;
grant execute on function public.ensure_world_boss_spawn() to authenticated;

-- ============================================================================
-- 6. world_boss_gather_attack_state — read-only gather for the Edge
--    Function, plain function granted only to service_role (no internal
--    ownership check — the trusted caller is world-boss-attack, which
--    already verified ownership via the caller's JWT before invoking this).
--    Mirrors the equipped_items join shape resolve_combat_gather_state
--    already uses.
-- ============================================================================
create or replace function public.world_boss_gather_attack_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_character jsonb;
  v_account_id uuid;
  v_equipped_ids uuid[];
  v_equipped_items jsonb;
  v_current_spawn_id uuid;
  v_spawn jsonb;
  v_participant jsonb;
  v_ascension_points integer;
begin
  select to_jsonb(c), c.account_id into v_character, v_account_id
  from public.characters c where c.id = p_character_id;

  if v_character is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_equipped_ids := array_remove(array[
    (v_character->>'equipped_weapon_id')::uuid,
    (v_character->>'equipped_ring_id')::uuid,
    (v_character->>'equipped_necklace_id')::uuid,
    (v_character->>'equipped_boots_id')::uuid,
    (v_character->>'equipped_hat_id')::uuid,
    (v_character->>'equipped_coat_id')::uuid
  ], null);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ii.id,
    'quality_tier', ii.quality_tier,
    'template_id', ii.template_id,
    'composition_level', ii.composition_level,
    'durability', ii.durability,
    'base_stats', it.base_stats,
    'slot_type', it.slot_type,
    'required_level', it.required_level
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids);

  select current_spawn_id into v_current_spawn_id from public.world_boss_state where id = 1;
  select to_jsonb(s) into v_spawn from public.world_boss_spawns s where s.id = v_current_spawn_id;

  select to_jsonb(p) into v_participant
  from public.world_boss_participants p
  where p.spawn_id = v_current_spawn_id and p.character_id = p_character_id;

  select ascension_points into v_ascension_points from public.players where id = v_account_id;

  return jsonb_build_object(
    'ok', true,
    'character', v_character,
    'equipped_items', v_equipped_items,
    'spawn', v_spawn,
    'participant', v_participant,
    'ascension_points', v_ascension_points
  );
end;
$$;

revoke all on function public.world_boss_gather_attack_state(uuid) from public;
grant execute on function public.world_boss_gather_attack_state(uuid) to service_role;

-- ============================================================================
-- 7. apply_world_boss_attack — the sole authoritative write path. Plain
--    function granted only to service_role. Re-validates every eligibility
--    check itself under lock (never trusts the Edge Function's own
--    pre-checks), so two racing attempts from the same character can't
--    double-spend an attempt or exceed the 10 free / 10 paid caps.
-- ============================================================================
create or replace function public.apply_world_boss_attack(p_character_id uuid, p_spawn_id uuid, p_damage integer)
returns jsonb
language plpgsql
as $$
declare
  v_current_spawn_id uuid;
  v_account_id uuid;
  v_participant_id uuid;
  v_free_used integer;
  v_paid_used integer;
  v_last_attempt_at timestamptz;
  v_status text;
  v_window_ends_at timestamptz;
  v_current_hp bigint;
  v_max_hp bigint;
  v_new_hp bigint;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_cooldown_ends_at timestamptz;
begin
  -- Lazy lifecycle trigger — guarantees the spawn this call validates
  -- against is current before anything else runs.
  perform public.ensure_world_boss_spawn();

  select current_spawn_id into v_current_spawn_id from public.world_boss_state where id = 1;
  if v_current_spawn_id <> p_spawn_id then
    return jsonb_build_object('ok', false, 'error', 'spawn_changed');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.world_boss_participants (spawn_id, character_id)
  values (p_spawn_id, p_character_id)
  on conflict (spawn_id, character_id) do nothing;

  select id, free_attempts_used, paid_attempts_used, last_attempt_at
  into v_participant_id, v_free_used, v_paid_used, v_last_attempt_at
  from public.world_boss_participants
  where spawn_id = p_spawn_id and character_id = p_character_id
  for update;

  select status, window_ends_at, current_hp, max_hp
  into v_status, v_window_ends_at, v_current_hp, v_max_hp
  from public.world_boss_spawns where id = p_spawn_id;

  if v_status <> 'active' or now() >= v_window_ends_at then
    return jsonb_build_object('ok', false, 'error', 'window_ended');
  end if;

  if v_current_hp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'boss_defeated');
  end if;

  if v_last_attempt_at is not null and now() - v_last_attempt_at < interval '5 minutes' then
    return jsonb_build_object(
      'ok', false, 'error', 'on_cooldown', 'cooldown_ends_at', v_last_attempt_at + interval '5 minutes'
    );
  end if;

  if v_free_used < 10 then
    v_payment := 'free';
  elsif v_paid_used < 10 then
    v_payment := 'paid';
    -- world_boss_participants already locked above; players locked here,
    -- second — same characters/participant-row-then-players lock ordering
    -- convention this project already uses elsewhere (draw_lucky_ticket,
    -- sell_item, create_marketplace_listing all lock characters before
    -- players), just with world_boss_participants standing in for
    -- characters as the first-locked row.
    select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
    if v_ap_balance < 2 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ap');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'no_attempts_remaining');
  end if;

  if v_payment = 'paid' then
    update public.players set ascension_points = ascension_points - 2 where id = v_account_id
    returning ascension_points into v_new_ap;
  end if;

  update public.world_boss_participants
  set
    free_attempts_used = free_attempts_used + case when v_payment = 'free' then 1 else 0 end,
    paid_attempts_used = paid_attempts_used + case when v_payment = 'paid' then 1 else 0 end,
    total_damage = total_damage + p_damage,
    last_attempt_at = now()
  where id = v_participant_id
  returning free_attempts_used, paid_attempts_used into v_free_used, v_paid_used;

  update public.world_boss_spawns
  set current_hp = greatest(current_hp - p_damage, 0)
  where id = p_spawn_id
  returning current_hp into v_new_hp;

  v_cooldown_ends_at := now() + interval '5 minutes';

  return jsonb_build_object(
    'ok', true,
    'damage', p_damage,
    'boss_current_hp', v_new_hp,
    'boss_max_hp', v_max_hp,
    'boss_defeated', v_new_hp <= 0,
    'free_attempts_used', v_free_used,
    'paid_attempts_used', v_paid_used,
    'ascension_points', v_new_ap,
    'cooldown_ends_at', v_cooldown_ends_at,
    'window_ends_at', v_window_ends_at,
    'payment', v_payment
  );
end;
$$;

revoke all on function public.apply_world_boss_attack(uuid, uuid, integer) from public;
grant execute on function public.apply_world_boss_attack(uuid, uuid, integer) to service_role;

-- ============================================================================
-- 8. get_world_boss_leaderboard — safe public snapshot RPC, same precedent
--    as view_character_loadout (no RLS lets a client read another account's
--    world_boss_participants rows directly). Returns the top 50 (placeholder
--    cutoff) by damage, plus the calling character's own rank/damage even if
--    outside that cutoff — the whole point of the trophy button per the
--    product spec ("see what position they are in").
-- ============================================================================
create or replace function public.get_world_boss_leaderboard(p_character_id uuid default null, p_spawn_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spawn_id uuid;
  v_entries jsonb;
  v_self jsonb;
begin
  v_spawn_id := coalesce(p_spawn_id, (select current_spawn_id from public.world_boss_state where id = 1));

  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', ranked.rn,
    'character_name', c.name,
    'total_damage', ranked.total_damage
  ) order by ranked.rn), '[]'::jsonb)
  into v_entries
  from (
    select character_id, total_damage, row_number() over (order by total_damage desc) as rn
    from public.world_boss_participants
    where spawn_id = v_spawn_id
    order by total_damage desc
    limit 50
  ) ranked
  join public.characters c on c.id = ranked.character_id;

  if p_character_id is not null then
    select jsonb_build_object('rank', ranked.rn, 'total_damage', ranked.total_damage)
    into v_self
    from (
      select character_id, total_damage, row_number() over (order by total_damage desc) as rn
      from public.world_boss_participants
      where spawn_id = v_spawn_id
    ) ranked
    where ranked.character_id = p_character_id;
  end if;

  return jsonb_build_object('ok', true, 'spawn_id', v_spawn_id, 'entries', v_entries, 'self', v_self);
end;
$$;

revoke all on function public.get_world_boss_leaderboard(uuid, uuid) from public;
grant execute on function public.get_world_boss_leaderboard(uuid, uuid) to authenticated;

commit;
