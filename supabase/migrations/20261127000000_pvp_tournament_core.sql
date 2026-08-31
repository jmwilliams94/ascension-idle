-- PvP Tournament / ladder layer (Phase 3, 2026-08-31) -- see CLAUDE.md's
-- plan nifty-riding-journal. Weekly, live-kickoff cadence: registration is
-- always open except during the event itself; Friday 12:00 Brisbane
-- (GMT+10, no DST, so this is a fixed 02:00 UTC cron) closes registration,
-- seeds Round 1, and starts every real pairing's duel simultaneously; later
-- rounds advance the instant every match in the current round has resolved.
--
-- Why this needs an Edge Function, not pure SQL like world_boss_spawns'
-- ensure_world_boss_spawn: every real match must start both duelists at
-- FULL HP freshly computed from their live level/class/gear (a tournament
-- round is not a continuation of previous damage) -- that HP formula is the
-- same TS mirror already duplicated into resolve-pvp-duel/index.ts
-- (derivedStats.ts/equipmentBonus.ts), which SQL has no way to reach.
-- Round-seeding therefore splits the same way resolve-combat's own
-- gather/compute/apply already does: a SQL gather function hands raw
-- character+equipment rows to the new pvp-tournament-advance Edge
-- Function, which computes HP and calls back into start_pvp_duel/
-- pvp_tournament_write_round to actually create the round.
--
-- Trigger chain: pg_cron (Friday kickoff) and pvp_duel_apply_action/
-- pvp_duel_gather_state (round-advance, the instant a tournament-linked
-- duel concludes) both fire a fire-and-forget net.http_post at
-- pvp-tournament-advance, same pattern as notify_lucky_ticket_ready
-- (20261028000000_lucky_ticket_push_notify.sql) -- reuses that migration's
-- existing `cron_push_secret` Vault secret rather than provisioning a new
-- one, since it's really just "a shared secret for trusted internal
-- server-to-server calls," not push-specific.
begin;

-- ============================================================================
-- 1. Schema
-- ============================================================================

create table public.pvp_tournaments (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'registration' check (status in ('registration', 'live', 'completed')),
  -- The upcoming (while status='registration'/'live') or most recently
  -- fired (while 'completed') Friday-noon-Brisbane instant.
  event_starts_at timestamptz not null,
  winner_character_id uuid references public.characters(id),
  -- Snapshots, not live lookups -- same "no RLS path across accounts"
  -- reasoning as pvp_duels.player_a_name/player_b_name (see that fix).
  winner_name text,
  champion_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pvp_tournaments enable row level security;
create policy "PvP tournaments are publicly viewable" on public.pvp_tournaments for select using (true);
grant select on public.pvp_tournaments to authenticated;
grant all on public.pvp_tournaments to service_role;
alter publication supabase_realtime add table public.pvp_tournaments;

create table public.pvp_tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.pvp_tournaments(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  character_name text not null,
  registered_at timestamptz not null default now(),
  unique (tournament_id, character_id)
);

alter table public.pvp_tournament_registrations enable row level security;
create policy "PvP tournament registrations are publicly viewable" on public.pvp_tournament_registrations for select using (true);
grant select on public.pvp_tournament_registrations to authenticated;
grant all on public.pvp_tournament_registrations to service_role;
-- No insert grant to any client role -- only register_for_pvp_tournament
-- (SECURITY DEFINER, below) writes here, so the character-name snapshot and
-- the "tournament still open" check can't be bypassed by a raw insert.
alter publication supabase_realtime add table public.pvp_tournament_registrations;

create table public.pvp_tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.pvp_tournaments(id) on delete cascade,
  round integer not null,
  slot integer not null,
  character_a_id uuid references public.characters(id),
  character_a_name text,
  character_b_id uuid references public.characters(id), -- null = bye
  character_b_name text,
  duel_id uuid references public.pvp_duels(id),
  winner_character_id uuid references public.characters(id),
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  unique (tournament_id, round, slot)
);

alter table public.pvp_tournament_matches enable row level security;
create policy "PvP tournament matches are publicly viewable" on public.pvp_tournament_matches for select using (true);
grant select on public.pvp_tournament_matches to authenticated;
grant all on public.pvp_tournament_matches to service_role;
alter publication supabase_realtime add table public.pvp_tournament_matches;

-- ============================================================================
-- 2. Registration (client-facing)
-- ============================================================================

-- Lazy-ensure, same "advance on whoever's client happens to call it next"
-- convention as ensure_world_boss_spawn -- guarantees a registration-open
-- tournament always exists for the client to register into. Computes the
-- next strictly-future Friday 02:00 UTC (= Friday 12:00 Brisbane, no DST)
-- from scratch; only actually used when no open tournament already exists
-- (the normal steady-state case is pvp_tournament_maybe_advance already
-- having created next week's row the moment this week's finished).
create or replace function public.ensure_pvp_tournament_registration_open()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_utc_now timestamp;
  v_friday_utc timestamp;
begin
  select id into v_id from public.pvp_tournaments where status = 'registration' limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'tournament_id', v_id, 'created', false);
  end if;

  v_utc_now := now() at time zone 'utc';
  -- date_trunc('week', ...) truncates to Monday 00:00 (ISO 8601); +4 days
  -- 2 hours lands on Friday 02:00 UTC of THIS week.
  v_friday_utc := date_trunc('week', v_utc_now) + interval '4 days 2 hours';
  if v_friday_utc <= v_utc_now then
    v_friday_utc := v_friday_utc + interval '7 days';
  end if;

  insert into public.pvp_tournaments (status, event_starts_at)
  values ('registration', v_friday_utc at time zone 'utc')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'tournament_id', v_id, 'created', true);
end;
$$;

revoke all on function public.ensure_pvp_tournament_registration_open() from public;
grant execute on function public.ensure_pvp_tournament_registration_open() to authenticated;

create or replace function public.register_for_pvp_tournament(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_tournament_id uuid;
begin
  select account_id, name into v_account_id, v_character_name
  from public.characters where id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select id into v_tournament_id from public.pvp_tournaments
  where status = 'registration'
  order by event_starts_at asc
  limit 1;

  if v_tournament_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_open_tournament');
  end if;

  insert into public.pvp_tournament_registrations (tournament_id, character_id, character_name)
  values (v_tournament_id, p_character_id, v_character_name)
  on conflict (tournament_id, character_id) do nothing;

  return jsonb_build_object('ok', true, 'tournament_id', v_tournament_id);
end;
$$;

revoke all on function public.register_for_pvp_tournament(uuid) from public;
grant execute on function public.register_for_pvp_tournament(uuid) to authenticated;

-- ============================================================================
-- 3. Round seeding (service-role only -- called from the Edge Function)
-- ============================================================================

-- Combat-relevant snapshot for an arbitrary character list -- deliberately
-- a fresh function rather than reusing pvp_duel_gather_state's equipped-
-- items shape, since that one omits `enchant` (never needed for a duel
-- action's own attack/defense math, but IS needed here for a fresh HP
-- computation's enchantHpBonus).
create or replace function public.pvp_tournament_gather_character_combat_data(p_character_ids uuid[])
returns jsonb
language plpgsql
as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'character_id', c.id,
      'class', c.class,
      'level', c.level,
      'equipped_items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'quality_tier', ii.quality_tier, 'composition_level', ii.composition_level,
          'durability', ii.durability, 'base_stats', it.base_stats, 'slot_type', it.slot_type,
          'sockets', coalesce(ii.sockets, '[]'::jsonb), 'enchant', ii.enchant
        )), '[]'::jsonb)
        from public.item_instances ii
        join public.item_templates it on it.id = ii.template_id
        where ii.id = any(array_remove(array[
          c.equipped_weapon_id, c.equipped_ring_id, c.equipped_necklace_id,
          c.equipped_boots_id, c.equipped_hat_id, c.equipped_coat_id
        ], null))
      )
    )), '[]'::jsonb)
    from public.characters c
    where c.id = any(p_character_ids)
  );
end;
$$;

revoke all on function public.pvp_tournament_gather_character_combat_data(uuid[]) from public;
grant execute on function public.pvp_tournament_gather_character_combat_data(uuid[]) to service_role;

-- p_pairings: jsonb array of {character_a_id, character_a_name,
-- character_a_hp, character_b_id, character_b_name, character_b_hp} --
-- character_b_* null/absent means a bye (character_a auto-advances, no
-- duel created). HP values are the Edge Function's freshly-computed full
-- HP for this round, never trusted from anywhere else.
create or replace function public.pvp_tournament_write_round(
  p_tournament_id uuid,
  p_round integer,
  p_pairings jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_pairing jsonb;
  v_slot integer := 0;
  v_total integer := 0;
  v_start_result jsonb;
  v_duel_id uuid;
begin
  for v_pairing in select * from jsonb_array_elements(p_pairings)
  loop
    v_slot := v_slot + 1;
    v_total := v_total + 1;

    if (v_pairing->>'character_b_id') is null then
      insert into public.pvp_tournament_matches (
        tournament_id, round, slot,
        character_a_id, character_a_name,
        winner_character_id, status
      ) values (
        p_tournament_id, p_round, v_slot,
        (v_pairing->>'character_a_id')::uuid, v_pairing->>'character_a_name',
        (v_pairing->>'character_a_id')::uuid, 'completed'
      );
    else
      select public.start_pvp_duel(
        (v_pairing->>'character_a_id')::uuid,
        (v_pairing->>'character_b_id')::uuid,
        (v_pairing->>'character_a_hp')::integer,
        (v_pairing->>'character_b_hp')::integer,
        (v_pairing->>'character_a_id')::uuid
      ) into v_start_result;

      v_duel_id := (v_start_result->>'duel_id')::uuid;

      insert into public.pvp_tournament_matches (
        tournament_id, round, slot,
        character_a_id, character_a_name,
        character_b_id, character_b_name,
        duel_id, status
      ) values (
        p_tournament_id, p_round, v_slot,
        (v_pairing->>'character_a_id')::uuid, v_pairing->>'character_a_name',
        (v_pairing->>'character_b_id')::uuid, v_pairing->>'character_b_name',
        v_duel_id, 'active'
      );
    end if;
  end loop;

  -- A single-slot round that was entirely a bye (the last real opponent
  -- dropped out) resolves the final immediately with no duel to wait on.
  if v_total = 1 then
    perform public.pvp_tournament_maybe_advance(p_tournament_id, p_round);
  end if;

  return jsonb_build_object('ok', true, 'matches_created', v_total);
end;
$$;

revoke all on function public.pvp_tournament_write_round(uuid, integer, jsonb) from public;
grant execute on function public.pvp_tournament_write_round(uuid, integer, jsonb) to service_role;

-- ============================================================================
-- 4. Round advancement (triggered from a concluded duel, or a bye)
-- ============================================================================

-- Called once a duel's status becomes final -- looks up whether that duel
-- belongs to a tournament match at all (a manual test duel via
-- start_pvp_duel's direct SQL-editor use is not linked to any match, and
-- this is a harmless no-op for those).
create or replace function public.pvp_tournament_record_duel_result(p_duel_id uuid, p_winner_character_id uuid)
returns void
language plpgsql
as $$
declare
  v_match public.pvp_tournament_matches;
begin
  select * into v_match from public.pvp_tournament_matches where duel_id = p_duel_id;
  if not found then
    return;
  end if;

  update public.pvp_tournament_matches
  set winner_character_id = p_winner_character_id, status = 'completed'
  where id = v_match.id;

  perform public.pvp_tournament_maybe_advance(v_match.tournament_id, v_match.round);
end;
$$;

revoke all on function public.pvp_tournament_record_duel_result(uuid, uuid) from public;
grant execute on function public.pvp_tournament_record_duel_result(uuid, uuid) to service_role;

-- Checks whether every match in (tournament_id, round) is now decided --
-- if so, either finalizes the tournament (this was the final) or fires the
-- Edge Function to seed the next round. A round with mid-progress matches
-- still pending is a silent no-op (called speculatively after every single
-- match, not just the last one to finish).
create or replace function public.pvp_tournament_maybe_advance(p_tournament_id uuid, p_round integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_completed integer;
  v_final_match public.pvp_tournament_matches;
  v_secret text;
begin
  select count(*), count(*) filter (where status = 'completed')
  into v_total, v_completed
  from public.pvp_tournament_matches
  where tournament_id = p_tournament_id and round = p_round;

  if v_total = 0 or v_completed < v_total then
    return;
  end if;

  if v_total = 1 then
    select * into v_final_match from public.pvp_tournament_matches
    where tournament_id = p_tournament_id and round = p_round;

    update public.pvp_tournaments
    set status = 'completed',
        winner_character_id = v_final_match.winner_character_id,
        winner_name = case when v_final_match.winner_character_id = v_final_match.character_a_id
          then v_final_match.character_a_name else v_final_match.character_b_name end,
        champion_title = 'Duel Champion',
        updated_at = now()
    where id = p_tournament_id;

    perform public.ensure_pvp_tournament_registration_open();
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_push_secret';
  if v_secret is null then
    return; -- same silent-no-op convention as notify_lucky_ticket_ready
  end if;

  perform net.http_post(
    url := 'https://bwyegfyvrcfchonzvffo.supabase.co/functions/v1/pvp-tournament-advance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_I11RHUV-HUDIrK_N4CivEg_6Ci7wCoQ',
      'X-Cron-Secret', v_secret
    ),
    body := jsonb_build_object('tournament_id', p_tournament_id, 'round', p_round + 1)
  );
end;
$$;

revoke all on function public.pvp_tournament_maybe_advance(uuid, integer) from public;
grant execute on function public.pvp_tournament_maybe_advance(uuid, integer) to service_role;

-- ============================================================================
-- 5. Friday-noon-Brisbane kickoff
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.pvp_tournament_kickoff_if_due()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_secret text;
begin
  select id into v_id from public.pvp_tournaments
  where status = 'registration' and event_starts_at <= now()
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.pvp_tournaments set status = 'live', updated_at = now() where id = v_id;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_push_secret';
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://bwyegfyvrcfchonzvffo.supabase.co/functions/v1/pvp-tournament-advance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_I11RHUV-HUDIrK_N4CivEg_6Ci7wCoQ',
      'X-Cron-Secret', v_secret
    ),
    body := jsonb_build_object('tournament_id', v_id, 'round', 1)
  );
end;
$$;

revoke all on function public.pvp_tournament_kickoff_if_due() from public;

select cron.schedule(
  'pvp-tournament-kickoff',
  '0 2 * * 5', -- Friday 02:00 UTC = Friday 12:00 Brisbane (GMT+10, no DST)
  $$select public.pvp_tournament_kickoff_if_due();$$
);

commit;
