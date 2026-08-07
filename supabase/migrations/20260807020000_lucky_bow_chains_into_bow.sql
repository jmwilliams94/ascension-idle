-- Lucky Bow can now Level Upgrade into the real Bow chain (confirmed with the
-- user, 2026-08-07). Lucky Bow is a standalone singleton family
-- ('lucky-bow', required_level 1) specifically so it stays out of the random
-- kill-drop pool and out of the ordinary Bow progression's own
-- nearest-level-match logic (see CLAUDE.md's Accounts & Characters ->
-- starter weapon note, and useInventoryStore.ts's NON_DROPPABLE_FAMILIES) —
-- none of that changes here. This migration only teaches the *next-template*
-- lookup (level_upgrade / master_forge_upgrade) that a 'lucky-bow' item's
-- next tier lives in the 'bow' family instead of searching its own
-- single-template family (which would otherwise always find nothing).
-- Once upgraded, the item's template_id points at a real Bow-family
-- template, so every later Level Upgrade follows the ordinary Bow chain with
-- no further special-casing needed.
create or replace function public.upgrade_chain_family(p_item_family text)
returns text
language sql
immutable
as $$
  select case when p_item_family = 'lucky-bow' then 'bow' else p_item_family end;
$$;

revoke all on function public.upgrade_chain_family(text) from public;

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
  v_quality_tier text;
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
  v_success_chance numeric;
  v_socket_roll_chance numeric := 0.01;
  v_comets integer;
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

  select account_id, comet_count into v_account_id, v_comets
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
  where item_family = public.upgrade_chain_family(v_item_family) and required_level > v_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

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
    'comets_spent', v_cost,
    'comets_remaining', v_comets - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

create or replace function public.master_forge_upgrade(item_id uuid, upgrade_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_level integer;
  v_template_id uuid;
  v_item_family text;
  v_required_level integer;
  v_slot_type text;
  v_quality_tier text;
  v_current_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_socket_roll_chance numeric := 0.01;
  v_success_chance numeric;
  v_cost integer;
  v_next_tier text;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_currency_owned integer;
begin
  if upgrade_type not in ('quality', 'level') then
    return jsonb_build_object('ok', false, 'error', 'invalid_upgrade_type');
  end if;

  select owner_id, quality_tier, level, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_quality_tier, v_current_level, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, level into v_account_id, v_character_level
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type, item_family, required_level into v_slot_type, v_item_family, v_required_level
  from public.item_templates where id = v_template_id;

  if upgrade_type = 'quality' then
    v_next_tier := case v_quality_tier
      when 'normal' then 'tempered'
      when 'tempered' then 'infused'
      when 'infused' then 'radiant'
      when 'radiant' then 'ascended'
      else null
    end;

    if v_next_tier is null then
      return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_quality_tier);
    end if;

    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'quality') / 100.0;
  else
    if v_item_family is null then
      return jsonb_build_object('ok', false, 'error', 'no_upgrade_path');
    end if;

    select id, required_level into v_next_template_id, v_next_required_level
    from public.item_templates
    where item_family = public.upgrade_chain_family(v_item_family) and required_level > v_required_level
    order by required_level asc
    limit 1;

    if v_next_template_id is null then
      return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
    end if;

    if v_next_required_level > v_character_level then
      return jsonb_build_object(
        'ok', false,
        'error', 'exceeds_character_level',
        'result_level', v_next_required_level,
        'character_level', v_character_level
      );
    end if;

    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'level') / 100.0;
  end if;

  v_cost := ceil((1.0 / v_success_chance) * 1.5);

  if upgrade_type = 'quality' then
    select fallen_star_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_stars', 'cost', v_cost, 'fallen_stars', v_currency_owned);
    end if;
    update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id
    returning fallen_star_count into v_currency_owned;
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  else
    select comet_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_comets', 'cost', v_cost, 'comets', v_currency_owned);
    end if;
    update public.characters set comet_count = comet_count - v_cost where id = v_character_id
    returning comet_count into v_currency_owned;
    update public.item_instances set template_id = v_next_template_id, level = v_next_required_level where id = item_id;
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
    'upgrade_type', upgrade_type,
    'cost', v_cost,
    'quality_tier', case when upgrade_type = 'quality' then v_next_tier else v_quality_tier end,
    'level', case when upgrade_type = 'level' then v_next_required_level else v_current_level end,
    'template_id', case when upgrade_type = 'level' then v_next_template_id else v_template_id end,
    'fallen_stars_remaining', case when upgrade_type = 'quality' then v_currency_owned else null end,
    'comets_remaining', case when upgrade_type = 'level' then v_currency_owned else null end,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;
