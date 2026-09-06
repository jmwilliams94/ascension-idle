-- PvP Tournament becomes one independent event PER CLASS (2026-09-05,
-- requested by the user): Hunter kicks off Saturday 12:00 Brisbane (unchanged
-- slot from the old single Friday-only event, just moved a day), Wuxia kicks
-- off Sunday 13:00 Brisbane (a brand new event) -- Twin-soul/Juggernaut have
-- no backend event yet (client shows "Coming Soon" for those, never calls
-- any of the RPCs below with their class). Brisbane is GMT+10, no DST, so
-- both are fixed UTC instants: Sat 12:00 Brisbane = Sat 02:00 UTC, Sun 13:00
-- Brisbane = Sun 03:00 UTC.
begin;

-- ============================================================================
-- 1) Schema: class_id scopes every tournament to one class's event line.
-- Every existing row to date is Hunter-only (register_for_pvp_tournament has
-- rejected non-Hunters since 20261215020000_pvp_tournament_hunter_only.sql),
-- so backfilling 'hunter' via the column default is accurate history, not a
-- guess.
-- ============================================================================
alter table public.pvp_tournaments
  add column if not exists class_id text not null default 'hunter'
  check (class_id in ('hunter', 'wuxia', 'twin-soul', 'juggernaut'));
-- Default kept permanently (not dropped after backfill) as a harmless safety
-- net for any future insert that forgets to pass it explicitly -- every
-- INSERT below already does pass it, same reasoning as pvp_tournaments.status
-- staying defaulted to 'registration'.

-- ============================================================================
-- 2) ensure_pvp_tournament_registration_open now takes p_class_id -- a
-- different arg LIST (0 args -> 1 arg), so `create or replace` alone would
-- create a second, ambiguous overload rather than replacing it (see CLAUDE.md's
-- "changing a function's argument list needs an explicit drop first" gotcha)
-- -- drop the old 0-arg version explicitly.
-- ============================================================================
drop function if exists public.ensure_pvp_tournament_registration_open();

create function public.ensure_pvp_tournament_registration_open(p_class_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_utc_now timestamp;
  v_target_dow integer; -- ISO: Monday=1 ... Sunday=7
  v_target_hour integer;
  v_target_utc timestamp;
begin
  if p_class_id not in ('hunter', 'wuxia') then
    return jsonb_build_object('ok', false, 'error', 'class_not_eligible');
  end if;

  select id into v_id from public.pvp_tournaments where status = 'registration' and class_id = p_class_id limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'tournament_id', v_id, 'created', false);
  end if;

  if exists (select 1 from public.pvp_tournaments where status = 'live' and class_id = p_class_id) then
    return jsonb_build_object('ok', true, 'tournament_id', null, 'created', false);
  end if;

  v_target_dow := case p_class_id when 'hunter' then 6 when 'wuxia' then 7 end;
  v_target_hour := case p_class_id when 'hunter' then 2 when 'wuxia' then 3 end;

  v_utc_now := now() at time zone 'utc';
  -- date_trunc('week', ...) truncates to Monday 00:00 (ISO 8601); offset by
  -- (dow - 1) days lands on the target weekday of THIS week.
  v_target_utc := date_trunc('week', v_utc_now) + (v_target_dow - 1) * interval '1 day' + v_target_hour * interval '1 hour';
  if v_target_utc <= v_utc_now then
    v_target_utc := v_target_utc + interval '7 days';
  end if;

  insert into public.pvp_tournaments (status, event_starts_at, class_id)
  values ('registration', v_target_utc at time zone 'utc', p_class_id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'tournament_id', v_id, 'created', true);
end;
$$;

revoke all on function public.ensure_pvp_tournament_registration_open(text) from public;
grant execute on function public.ensure_pvp_tournament_registration_open(text) to authenticated;

-- ============================================================================
-- 3) register_for_pvp_tournament -- same 1-arg signature, so no drop needed.
-- Now finds the caller's OWN class's open tournament instead of assuming
-- there's only ever one (Hunter's), and accepts Wuxia too.
-- ============================================================================
create or replace function public.register_for_pvp_tournament(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_character_class text;
  v_tournament_id uuid;
begin
  select account_id, name, class into v_account_id, v_character_name, v_character_class
  from public.characters where id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_character_class not in ('hunter', 'wuxia') then
    return jsonb_build_object('ok', false, 'error', 'class_not_eligible');
  end if;

  select id into v_tournament_id from public.pvp_tournaments
  where status = 'registration' and class_id = v_character_class
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
-- 4) pvp_tournament_maybe_advance -- same 2-arg signature, so no drop needed.
-- champion_title is now class-specific ('Top Hunter' / 'Top Wuxia'), and the
-- next event it opens (ensure_pvp_tournament_registration_open) is scoped to
-- THIS tournament's own class, not a blanket no-arg call.
-- ============================================================================
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
  v_winner_name text;
  v_class_id text;
  v_champion_title text;
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

    v_winner_name := case when v_final_match.winner_character_id = v_final_match.character_a_id
      then v_final_match.character_a_name else v_final_match.character_b_name end;

    select class_id into v_class_id from public.pvp_tournaments where id = p_tournament_id;
    v_champion_title := case v_class_id when 'hunter' then 'Top Hunter' when 'wuxia' then 'Top Wuxia' else 'Champion' end;

    update public.pvp_tournaments
    set status = 'completed',
        winner_character_id = v_final_match.winner_character_id,
        winner_name = v_winner_name,
        champion_title = v_champion_title,
        updated_at = now()
    where id = p_tournament_id;

    insert into public.global_announcements (kind, character_name, message)
    values ('pvp_champion', v_winner_name, v_winner_name || ' has been crowned the ' || v_champion_title || '!');

    perform public.ensure_pvp_tournament_registration_open(v_class_id);
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
-- 5) pvp_tournament_kickoff_if_due -- same 0-arg signature, so no drop
-- needed. Now loops over EVERY due 'registration' tournament across all
-- classes instead of assuming there's only ever one -- both the new Saturday
-- (Hunter) and Sunday (Wuxia) cron entries below call this same function;
-- whichever fires just picks up whatever's actually due at that moment.
-- ============================================================================
create or replace function public.pvp_tournament_kickoff_if_due()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_secret text;
begin
  for v_row in
    select id from public.pvp_tournaments
    where status = 'registration' and event_starts_at <= now()
  loop
    update public.pvp_tournaments set status = 'live', updated_at = now() where id = v_row.id;

    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_push_secret';
    if v_secret is null then
      continue;
    end if;

    perform net.http_post(
      url := 'https://bwyegfyvrcfchonzvffo.supabase.co/functions/v1/pvp-tournament-advance',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_I11RHUV-HUDIrK_N4CivEg_6Ci7wCoQ',
        'X-Cron-Secret', v_secret
      ),
      body := jsonb_build_object('tournament_id', v_row.id, 'round', 1)
    );
  end loop;
end;
$$;

revoke all on function public.pvp_tournament_kickoff_if_due() from public;

select cron.unschedule('pvp-tournament-kickoff');

select cron.schedule(
  'pvp-tournament-kickoff-hunter',
  '0 2 * * 6', -- Saturday 02:00 UTC = Saturday 12:00 Brisbane
  $$select public.pvp_tournament_kickoff_if_due();$$
);

select cron.schedule(
  'pvp-tournament-kickoff-wuxia',
  '0 3 * * 0', -- Sunday 03:00 UTC = Sunday 13:00 Brisbane
  $$select public.pvp_tournament_kickoff_if_due();$$
);

-- ============================================================================
-- 6) Data fixes for the live rows that predate class_id.
-- ============================================================================

-- The already-open Hunter registration tournament (ebad87b5-...) has 1 real
-- registrant -- keep the row (and its registrations) in place, just correct
-- its stale Friday date to the new Saturday slot. Same date math as
-- ensure_pvp_tournament_registration_open('hunter') above.
update public.pvp_tournaments
set event_starts_at = (
  case
    when (date_trunc('week', now() at time zone 'utc') + interval '5 days' + interval '2 hours') <= (now() at time zone 'utc')
    then date_trunc('week', now() at time zone 'utc') + interval '12 days' + interval '2 hours'
    else date_trunc('week', now() at time zone 'utc') + interval '5 days' + interval '2 hours'
  end
) at time zone 'utc'
where status = 'registration' and class_id = 'hunter';

-- Wuxia's first-ever event: open its own registration row now (Sunday 13:00
-- Brisbane).
select public.ensure_pvp_tournament_registration_open('wuxia');

commit;
