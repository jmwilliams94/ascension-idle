-- PvP Tournament is a Hunter-only event (2026-09-05, requested by the user
-- after finding a Wuxia registered for the upcoming event) -- the original
-- design note ("any class") is superseded by this. register_for_pvp_tournament
-- now rejects any non-Hunter character outright, same signature so
-- `create or replace` is safe without a `drop function` first.
--
-- Also clears every registration on the currently-open tournament -- it
-- predates this rule and has a Wuxia (Wuxard) in it alongside two Hunters
-- (Huntard, Switchee); rather than surgically removing just the invalid
-- entry, wipe the small test roster and let everyone re-register clean
-- under the new rule ahead of today's kickoff.
begin;

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

  if v_character_class <> 'hunter' then
    return jsonb_build_object('ok', false, 'error', 'class_not_eligible');
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

delete from public.pvp_tournament_registrations
where tournament_id = (select id from public.pvp_tournaments where status = 'registration' limit 1);

commit;
