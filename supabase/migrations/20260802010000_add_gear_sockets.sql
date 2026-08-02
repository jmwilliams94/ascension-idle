-- Sockets (see CLAUDE.md's Sockets section) -- finalized design, never built
-- until now. Asymmetric by item type:
--   Weapons: guaranteed unlock, player-paid. 1 DragonBall for socket 1, 5 for
--   socket 2. New unlock_weapon_socket(item_id) RPC below.
--   Armor (ring/necklace/boots/hat/coat): RNG side effect, ~1/100 chance to
--   gain a socket on any Quality or Level Upgrade *attempt* -- rolls
--   regardless of whether the tier/level upgrade itself succeeds, since
--   materials are already spent either way (matches the existing
--   "cost is spent regardless of outcome" behavior both functions already
--   have). Framed as a side effect of performing the upgrade, not a reward
--   tied to its own success -- CLAUDE.md doesn't specify which reading is
--   correct, this is the interpretation taken.
-- Max 2 sockets either way. Gems aren't implemented as items yet (see
-- CLAUDE.md's Gem system table) -- a socket just sits Empty once unlocked;
-- inserting a gem is a future step.
--
-- item_instances.sockets is the existing jsonb array column (default '[]'),
-- unused until now -- an unlocked-but-empty socket is represented as a plain
-- jsonb `null` array element (e.g. one socket = '[null]', two = '[null,
-- null]'). No schema change needed: appending via `sockets || 'null'::jsonb`
-- relies on jsonb `||`'s documented behavior of wrapping a non-array RHS into
-- a single-element array before concatenating.
begin;

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
  v_sockets jsonb;
  v_socket_count integer;
  v_cost integer;
  v_dragonballs integer;
begin
  select owner_id, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, dragonball_count into v_account_id, v_dragonballs
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type into v_slot_type from public.item_templates where id = v_template_id;

  if v_slot_type is distinct from 'weapon' then
    return jsonb_build_object('ok', false, 'error', 'not_a_weapon');
  end if;

  v_socket_count := jsonb_array_length(v_sockets);

  if v_socket_count >= 2 then
    return jsonb_build_object('ok', false, 'error', 'max_sockets', 'sockets', v_sockets);
  end if;

  v_cost := case v_socket_count when 0 then 1 else 5 end;

  if v_dragonballs < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_dragonballs',
      'cost', v_cost,
      'dragonballs', v_dragonballs
    );
  end if;

  update public.characters set dragonball_count = dragonball_count - v_cost where id = v_character_id;

  update public.item_instances
  set sockets = v_sockets || 'null'::jsonb
  where id = item_id
  returning sockets into v_sockets;

  return jsonb_build_object(
    'ok', true,
    'sockets', v_sockets,
    'dragonballs_spent', v_cost,
    'dragonballs_remaining', v_dragonballs - v_cost
  );
end;
$$;

grant execute on function public.unlock_weapon_socket(uuid) to authenticated;

create or replace function public.quality_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_tier text;
  v_next_tier text;
  v_template_id uuid;
  v_slot_type text;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric := 0.7;
  v_socket_roll_chance numeric := 0.01;
  v_dragonballs integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, dragonball_count into v_account_id, v_dragonballs
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type into v_slot_type from public.item_templates where id = v_template_id;

  v_next_tier := case v_current_tier
    when 'normal' then 'refined'
    when 'refined' then 'unique'
    when 'unique' then 'elite'
    when 'elite' then 'super'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  if v_dragonballs < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_dragonballs',
      'cost', v_cost,
      'dragonballs', v_dragonballs
    );
  end if;

  update public.characters set dragonball_count = dragonball_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'dragonballs_spent', v_cost,
    'dragonballs_remaining', v_dragonballs - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

create or replace function public.level_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_level integer;
  v_template_id uuid;
  v_item_family text;
  v_slot_type text;
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric := 0.8;
  v_socket_roll_chance numeric := 0.01;
  v_meteors integer;
  v_upgraded boolean;
begin
  select owner_id, level, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_level, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, meteor_count into v_account_id, v_meteors
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select item_family, required_level, slot_type into v_item_family, v_required_level, v_slot_type
  from public.item_templates
  where id = v_template_id;

  if v_item_family is null then
    return jsonb_build_object('ok', false, 'error', 'no_upgrade_path');
  end if;

  select id, required_level into v_next_template_id, v_next_required_level
  from public.item_templates
  where item_family = v_item_family and required_level > v_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

  if v_meteors < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_meteors',
      'cost', v_cost,
      'meteors', v_meteors
    );
  end if;

  update public.characters set meteor_count = meteor_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances
    set template_id = v_next_template_id, level = v_next_required_level
    where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_next_required_level else v_current_level end,
    'template_id', case when v_upgraded then v_next_template_id else v_template_id end,
    'meteors_spent', v_cost,
    'meteors_remaining', v_meteors - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

commit;
