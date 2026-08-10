-- Forge: equipped-item Level Upgrade guard (2026-08-14, requested by the
-- user alongside adding an "equipped item" picker to every Forge tool, not
-- just Master Forge — see EquippedGearPicker.tsx). master_forge_upgrade
-- already refuses a Level Upgrade result above the character's own level,
-- unconditionally (any item, equipped or not — left unchanged here, per the
-- user's explicit choice). The plain Forge tile's level_upgrade/
-- level_upgrade_scroll had no such check at all, since an equipped item was
-- never reachable there before now. The new rule is narrower than Master
-- Forge's: only block when the item being upgraded is *currently equipped*
-- — a plain Inventory item can still be over-leveled freely (the player
-- just won't be able to re-equip it), matching this tile's existing,
-- deliberate "no restriction" design for un-equipped gear.
--
-- Bodies are otherwise unchanged copies of level_upgrade
-- (20260810030000_fix_socket_announcement_stale_name.sql) and
-- level_upgrade_scroll (20260813090000_forge_scroll_batch_upgrade.sql) —
-- keep the shared bits in sync if either changes again.

create or replace function public.level_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_name text;
  v_character_level integer;
  v_is_equipped boolean;
  v_current_level integer;
  v_quality_tier text;
  v_template_id uuid;
  v_item_family text;
  v_item_name text;
  v_slot_type text;
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric;
  v_socket_roll_chance numeric := 0.01;
  v_comets integer;
  v_comet_scrolls integer;
  v_ensure_result jsonb;
  v_upgraded boolean;
begin
  select owner_id, level, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_level, v_quality_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, comet_count, name, level,
         coalesce(
           item_id = equipped_weapon_id or item_id = equipped_ring_id or item_id = equipped_necklace_id
           or item_id = equipped_boots_id or item_id = equipped_hat_id or item_id = equipped_coat_id,
           false
         )
  into v_account_id, v_comets, v_character_name, v_character_level, v_is_equipped
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select item_family, required_level, slot_type, name
  into v_item_family, v_required_level, v_slot_type, v_item_name
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

  if v_is_equipped and v_next_required_level > v_character_level then
    return jsonb_build_object(
      'ok', false,
      'error', 'exceeds_character_level',
      'result_level', v_next_required_level,
      'character_level', v_character_level
    );
  end if;

  v_ensure_result := public.ensure_loose_currency(v_character_id, 'comet', v_cost);
  if not (v_ensure_result->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room_to_unbundle', 'cost', v_cost);
  end if;
  select comet_count, comet_scroll_count into v_comets, v_comet_scrolls
  from public.characters where id = v_character_id;

  if v_comets < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_comets',
      'cost', v_cost,
      'comets', v_comets
    );
  end if;

  v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'level') / 100.0;

  update public.characters set comet_count = comet_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances
    set template_id = v_next_template_id, level = v_next_required_level
    where id = item_id;

    -- Refresh the name to the item's new tier before it can be used below.
    select name into v_item_name from public.item_templates where id = v_next_template_id;
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

    insert into public.global_announcements (kind, character_name, message)
    values (
      'armor_socket',
      v_character_name,
      v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained a socket!'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_next_required_level else v_current_level end,
    'template_id', case when v_upgraded then v_next_template_id else v_template_id end,
    'comets_spent', v_cost,
    'comets_remaining', v_comets - v_cost,
    'comet_scrolls_remaining', v_comet_scrolls,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

create or replace function public.level_upgrade_scroll(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_name text;
  v_character_level integer;
  v_is_equipped boolean;
  v_current_level integer;
  v_quality_tier text;
  v_template_id uuid;
  v_item_family text;
  v_item_name text;
  v_slot_type text;
  v_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_socket_roll_chance numeric := 0.01;
  v_comet_scrolls integer;
  v_success_chance numeric;
  v_upgraded boolean;
  v_rolls_attempted integer := 0;
  v_rolls_succeeded integer := 0;
  v_next_template_id uuid;
  v_next_required_level integer;
  i integer;
begin
  select owner_id, level, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_level, v_quality_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, comet_scroll_count, name, level,
         coalesce(
           item_id = equipped_weapon_id or item_id = equipped_ring_id or item_id = equipped_necklace_id
           or item_id = equipped_boots_id or item_id = equipped_hat_id or item_id = equipped_coat_id,
           false
         )
  into v_account_id, v_comet_scrolls, v_character_name, v_character_level, v_is_equipped
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_comet_scrolls < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_comet_scrolls');
  end if;

  select item_family, required_level, slot_type, name
  into v_item_family, v_required_level, v_slot_type, v_item_name
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

  -- Refused upfront, before the Scroll is spent, if even the very first
  -- roll in the batch would already put an equipped item above the
  -- character's level.
  if v_is_equipped and v_next_required_level > v_character_level then
    return jsonb_build_object(
      'ok', false,
      'error', 'exceeds_character_level',
      'result_level', v_next_required_level,
      'character_level', v_character_level
    );
  end if;

  -- Spent up front, regardless of how many of the 10 rolls actually execute
  -- or succeed -- no partial refund for rolls left unused after the item
  -- tops out mid-batch (or, now, hits the equipped-item level ceiling).
  update public.characters set comet_scroll_count = comet_scroll_count - 1 where id = v_character_id
  returning comet_scroll_count into v_comet_scrolls;

  for i in 1..10 loop
    -- Re-resolve against the *current* chain position every iteration -- a
    -- prior successful iteration may have already advanced v_template_id/
    -- v_required_level.
    select id, required_level into v_next_template_id, v_next_required_level
    from public.item_templates
    where item_family = v_item_family and required_level > v_required_level
    order by required_level asc
    limit 1;

    exit when v_next_template_id is null; -- topped out; remaining rolls wasted, no refund
    exit when v_is_equipped and v_next_required_level > v_character_level; -- would exceed character level; remaining rolls wasted, no refund

    v_rolls_attempted := v_rolls_attempted + 1;
    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'level') / 100.0;
    v_upgraded := random() < v_success_chance;

    if v_upgraded then
      v_rolls_succeeded := v_rolls_succeeded + 1;
      v_template_id := v_next_template_id;
      v_required_level := v_next_required_level;
      v_current_level := v_next_required_level;

      select name into v_item_name from public.item_templates where id = v_template_id;

      -- Socket roll only fires on a successful upgrade roll within the batch
      -- (deliberately different from level_upgrade's own every-attempt roll).
      v_socket_count := jsonb_array_length(v_sockets);
      if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
         and v_socket_count < 2
         and random() < v_socket_roll_chance then
        v_sockets := v_sockets || 'null'::jsonb;
        v_socket_gained := true;

        insert into public.global_announcements (kind, character_name, message)
        values (
          'armor_socket',
          v_character_name,
          v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained a socket!'
        );
      end if;
    end if;
  end loop;

  update public.item_instances
  set template_id = v_template_id, level = v_current_level, sockets = v_sockets
  where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_rolls_succeeded > 0,
    'rolls_attempted', v_rolls_attempted,
    'rolls_succeeded', v_rolls_succeeded,
    'level', v_current_level,
    'template_id', v_template_id,
    'comet_scrolls_remaining', v_comet_scrolls,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

revoke all on function public.level_upgrade_scroll(uuid) from public;
grant execute on function public.level_upgrade_scroll(uuid) to authenticated;
