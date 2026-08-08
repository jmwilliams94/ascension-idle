-- Gem socketing (2026-08-10, follow-up to 20260809010000_gem_inventory_and_bank.sql
-- which made gems real physical Inventory items but never wired up actually
-- socketing one). Confirmed with the user: a socket can be filled or
-- overwritten with a different gem, but a filled socket can never be
-- returned to empty — there's deliberately no "unsocket" path here or
-- anywhere else. A filled socket is stored as a plain jsonb string in
-- gemStorageKey format ("<gemId>_<tier>", e.g. "drake_tempered") — an
-- unlocked-but-empty socket stays a jsonb null, same as before this
-- migration (see 20260802010000_add_gear_sockets.sql).
create or replace function public.socket_gem(item_id uuid, socket_index integer, gem_id text, gem_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_sockets jsonb;
  v_socket_count integer;
  v_gems jsonb;
  v_gem_key text;
  v_gem_owned integer;
begin
  if gem_id not in ('drake', 'ember', 'bastion', 'iris') then
    return jsonb_build_object('ok', false, 'error', 'invalid_gem');
  end if;
  if gem_tier not in ('normal', 'tempered', 'ascended') then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;
  if socket_index is null or socket_index < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_socket_index');
  end if;

  select owner_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, gems into v_account_id, v_gems
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if socket_index >= v_socket_count then
    return jsonb_build_object('ok', false, 'error', 'socket_not_unlocked');
  end if;

  v_gem_key := gem_id || '_' || gem_tier;
  v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
  if v_gem_owned < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gems');
  end if;

  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned - 1));
  update public.characters set gems = v_gems where id = v_character_id;

  v_sockets := jsonb_set(v_sockets, array[socket_index::text], to_jsonb(v_gem_key));
  update public.item_instances set sockets = v_sockets where id = item_id;

  return jsonb_build_object('ok', true, 'sockets', v_sockets, 'gems', v_gems);
end;
$$;

revoke all on function public.socket_gem(uuid, integer, text, text) from public;
grant execute on function public.socket_gem(uuid, integer, text, text) to authenticated;
