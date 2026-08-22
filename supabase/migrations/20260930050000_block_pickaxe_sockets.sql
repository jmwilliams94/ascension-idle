-- Pickaxe can't unlock weapon sockets (requested by the user) -- now that
-- Pickaxe is slot_type = 'weapon' (see 20260930030000_pickaxe_as_normal_weapon.sql),
-- unlock_weapon_socket's existing "must be slot_type = 'weapon'" check no
-- longer excludes it. Progression stays exclusively on the bespoke Tier Up
-- system, same reasoning already applied to Level/Quality Upgrade being left
-- alone (a low-value redundancy, not touched) except sockets are a genuine
-- new capability (not a redundant progression path), so this one IS blocked.
-- Body otherwise an unchanged copy of the latest version (20260808020000).
create or replace function public.unlock_weapon_socket(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_slot_type text;
  v_item_family text;
  v_sockets jsonb;
  v_socket_count integer;
  v_cost integer;
  v_fallen_stars integer;
  v_fallen_star_scrolls integer;
  v_ensure_result jsonb;
begin
  select owner_id, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, fallen_star_count into v_account_id, v_fallen_stars
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type, item_family into v_slot_type, v_item_family from public.item_templates where id = v_template_id;

  if v_slot_type is distinct from 'weapon' then
    return jsonb_build_object('ok', false, 'error', 'not_a_weapon');
  end if;

  if v_item_family = 'pickaxe' then
    return jsonb_build_object('ok', false, 'error', 'no_sockets_on_pickaxe');
  end if;

  v_socket_count := jsonb_array_length(v_sockets);

  if v_socket_count >= 2 then
    return jsonb_build_object('ok', false, 'error', 'max_sockets', 'sockets', v_sockets);
  end if;

  v_cost := case v_socket_count when 0 then 1 else 5 end;

  v_ensure_result := public.ensure_loose_currency(v_character_id, 'fallen_star', v_cost);
  if not (v_ensure_result->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room_to_unbundle', 'cost', v_cost);
  end if;
  select fallen_star_count, fallen_star_scroll_count into v_fallen_stars, v_fallen_star_scrolls
  from public.characters where id = v_character_id;

  if v_fallen_stars < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_fallen_stars',
      'cost', v_cost,
      'fallen_stars', v_fallen_stars
    );
  end if;

  update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id;

  update public.item_instances
  set sockets = v_sockets || 'null'::jsonb
  where id = item_id
  returning sockets into v_sockets;

  return jsonb_build_object(
    'ok', true,
    'sockets', v_sockets,
    'fallen_stars_spent', v_cost,
    'fallen_stars_remaining', v_fallen_stars - v_cost,
    'fallen_star_scrolls_remaining', v_fallen_star_scrolls
  );
end;
$$;

revoke all on function public.unlock_weapon_socket(uuid) from public;
grant execute on function public.unlock_weapon_socket(uuid) to authenticated;
