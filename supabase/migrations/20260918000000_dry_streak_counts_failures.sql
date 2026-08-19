-- Fixes the socket dry streak (character_stats.quality_socket_dry_streak /
-- level_socket_dry_streak, added in 20260905000000_character_upgrade_stats.sql)
-- to count every upgrade *attempt* since the last socket proc, not just the
-- successful ones. Previously record_successful_upgrade() was only called
-- from inside each function's `if v_upgraded then` branch, so a streak of
-- e.g. "12" understated how many Comets/Fallen Stars were actually spent --
-- failed attempts still cost currency but never touched the streak.
--
-- record_successful_upgrade(character_id, upgrade_type, socket_gained) is
-- replaced by record_upgrade_attempt(character_id, upgrade_type, succeeded,
-- socket_gained): the streak column now increments on every call regardless
-- of `succeeded`, while the lifetime successful_quality_upgrades /
-- successful_level_upgrades counters only increment when succeeded is true.
-- Same-signature-change note doesn't apply here since this is a rename
-- (new name, no old overload left behind) -- old function is dropped.
--
-- Same-signature create-or-replace on all 5 socket-rolling functions, same
-- precedent as 20260905000000 itself. In the two scroll functions, the call
-- moves from inside `if v_upgraded then` to unconditionally once per
-- attempted roll in the batch (v_iter_socket_gained now initialized before
-- the success check, not inside it).
begin;

drop function if exists public.record_successful_upgrade(uuid, text, boolean);

create or replace function public.record_upgrade_attempt(
  p_character_id uuid,
  p_upgrade_type text,
  p_succeeded boolean,
  p_socket_gained boolean
)
returns integer
language plpgsql
as $$
declare
  v_streak integer;
  v_success_increment integer := case when p_succeeded then 1 else 0 end;
begin
  if p_upgrade_type = 'quality' then
    insert into public.character_stats (character_id, successful_quality_upgrades, quality_socket_dry_streak)
    values (p_character_id, v_success_increment, 1)
    on conflict (character_id) do update
      set successful_quality_upgrades = character_stats.successful_quality_upgrades + v_success_increment,
          quality_socket_dry_streak = character_stats.quality_socket_dry_streak + 1
    returning quality_socket_dry_streak into v_streak;

    if p_socket_gained then
      update public.character_stats set quality_socket_dry_streak = 0 where character_id = p_character_id;
    end if;
  else
    insert into public.character_stats (character_id, successful_level_upgrades, level_socket_dry_streak)
    values (p_character_id, v_success_increment, 1)
    on conflict (character_id) do update
      set successful_level_upgrades = character_stats.successful_level_upgrades + v_success_increment,
          level_socket_dry_streak = character_stats.level_socket_dry_streak + 1
    returning level_socket_dry_streak into v_streak;

    if p_socket_gained then
      update public.character_stats set level_socket_dry_streak = 0 where character_id = p_character_id;
    end if;
  end if;

  return v_streak;
end;
$$;

revoke all on function public.record_upgrade_attempt(uuid, text, boolean, boolean) from public;
grant execute on function public.record_upgrade_attempt(uuid, text, boolean, boolean) to authenticated;

-- ============================================================================
-- 1. quality_upgrade
-- ============================================================================
create or replace function public.quality_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_name text;
  v_current_tier text;
  v_next_tier text;
  v_template_id uuid;
  v_slot_type text;
  v_item_family text;
  v_item_name text;
  v_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_ordinal text;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric;
  v_socket_roll_chance numeric := 0.01;
  v_fallen_stars integer;
  v_fallen_star_scrolls integer;
  v_ensure_result jsonb;
  v_upgraded boolean;
  v_dry_streak integer;
begin
  select owner_id, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, fallen_star_count, name into v_account_id, v_fallen_stars, v_character_name
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type, item_family, required_level, name
  into v_slot_type, v_item_family, v_required_level, v_item_name
  from public.item_templates where id = v_template_id;

  v_next_tier := case v_current_tier
    when 'normal' then 'tempered'
    when 'tempered' then 'infused'
    when 'infused' then 'radiant'
    when 'radiant' then 'ascended'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

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

  v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_current_tier, 'quality') / 100.0;

  update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_upgraded
     and v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance * public.gold_donation_socket_multiplier() then
    v_socket_ordinal := case v_socket_count when 0 then '1st' else '2nd' end;
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;

    insert into public.global_announcements (kind, character_name, message)
    values (
      'armor_socket',
      v_character_name,
      v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained its ' || v_socket_ordinal || ' socket!'
    );
  end if;

  v_dry_streak := public.record_upgrade_attempt(v_character_id, 'quality', v_upgraded, v_socket_gained);
  if v_socket_gained then
    insert into public.global_announcements (kind, character_name, message)
    values (
      'socket_dry_streak_end',
      v_character_name,
      v_character_name || '''s Quality Upgrade dry streak of ' || v_dry_streak || ' has ended.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'fallen_stars_spent', v_cost,
    'fallen_stars_remaining', v_fallen_stars - v_cost,
    'fallen_star_scrolls_remaining', v_fallen_star_scrolls,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- 2. level_upgrade
-- ============================================================================
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
  v_socket_ordinal text;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric;
  v_socket_roll_chance numeric := 0.0025;
  v_comets integer;
  v_comet_scrolls integer;
  v_ensure_result jsonb;
  v_upgraded boolean;
  v_dry_streak integer;
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
  if v_upgraded
     and v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance * public.gold_donation_socket_multiplier() then
    v_socket_ordinal := case v_socket_count when 0 then '1st' else '2nd' end;
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;

    insert into public.global_announcements (kind, character_name, message)
    values (
      'armor_socket',
      v_character_name,
      v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained its ' || v_socket_ordinal || ' socket!'
    );
  end if;

  v_dry_streak := public.record_upgrade_attempt(v_character_id, 'level', v_upgraded, v_socket_gained);
  if v_socket_gained then
    insert into public.global_announcements (kind, character_name, message)
    values (
      'socket_dry_streak_end',
      v_character_name,
      v_character_name || '''s Level Upgrade dry streak of ' || v_dry_streak || ' has ended.'
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

-- ============================================================================
-- 3. master_forge_upgrade (guaranteed success -- p_succeeded is always true)
-- ============================================================================
create or replace function public.master_forge_upgrade(item_id uuid, upgrade_type text)
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
  v_template_id uuid;
  v_item_family text;
  v_item_name text;
  v_required_level integer;
  v_slot_type text;
  v_quality_tier text;
  v_current_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_ordinal text;
  v_socket_gained boolean := false;
  v_socket_roll_chance numeric;
  v_success_chance numeric;
  v_cost integer;
  v_next_tier text;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_currency_owned integer;
  v_scrolls_remaining integer;
  v_ensure_result jsonb;
  v_dry_streak integer;
begin
  if upgrade_type not in ('quality', 'level') then
    return jsonb_build_object('ok', false, 'error', 'invalid_upgrade_type');
  end if;

  v_socket_roll_chance := case upgrade_type when 'level' then 0.0025 else 0.01 end;

  select owner_id, quality_tier, level, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_quality_tier, v_current_level, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, level, name into v_account_id, v_character_level, v_character_name
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type, item_family, required_level, name
  into v_slot_type, v_item_family, v_required_level, v_item_name
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
    where item_family = v_item_family and required_level > v_required_level
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
    v_ensure_result := public.ensure_loose_currency(v_character_id, 'fallen_star', v_cost);
    if not (v_ensure_result->>'ok')::boolean then
      return jsonb_build_object('ok', false, 'error', 'not_enough_room_to_unbundle', 'cost', v_cost);
    end if;

    select fallen_star_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_stars', 'cost', v_cost, 'fallen_stars', v_currency_owned);
    end if;
    update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id
    returning fallen_star_count into v_currency_owned;
    select fallen_star_scroll_count into v_scrolls_remaining from public.characters where id = v_character_id;
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  else
    v_ensure_result := public.ensure_loose_currency(v_character_id, 'comet', v_cost);
    if not (v_ensure_result->>'ok')::boolean then
      return jsonb_build_object('ok', false, 'error', 'not_enough_room_to_unbundle', 'cost', v_cost);
    end if;

    select comet_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_comets', 'cost', v_cost, 'comets', v_currency_owned);
    end if;
    update public.characters set comet_count = comet_count - v_cost where id = v_character_id
    returning comet_count into v_currency_owned;
    select comet_scroll_count into v_scrolls_remaining from public.characters where id = v_character_id;
    update public.item_instances set template_id = v_next_template_id, level = v_next_required_level where id = item_id;

    -- Refresh the name to the item's new tier before it can be used below --
    -- master_forge_upgrade's level branch is guaranteed-success, so this
    -- always fires when upgrade_type = 'level'.
    select name into v_item_name from public.item_templates where id = v_next_template_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance * public.gold_donation_socket_multiplier() then
    v_socket_ordinal := case v_socket_count when 0 then '1st' else '2nd' end;
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;

    insert into public.global_announcements (kind, character_name, message)
    values (
      'armor_socket',
      v_character_name,
      v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained its ' || v_socket_ordinal || ' socket!'
    );
  end if;

  v_dry_streak := public.record_upgrade_attempt(v_character_id, upgrade_type, true, v_socket_gained);
  if v_socket_gained then
    insert into public.global_announcements (kind, character_name, message)
    values (
      'socket_dry_streak_end',
      v_character_name,
      v_character_name || '''s ' || (case upgrade_type when 'level' then 'Level Upgrade' else 'Quality Upgrade' end)
        || ' dry streak of ' || v_dry_streak || ' has ended.'
    );
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
    'scrolls_remaining', v_scrolls_remaining,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- 4. level_upgrade_scroll -- streak recorded once per attempted roll in the batch
-- ============================================================================
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
  v_socket_ordinal text;
  v_socket_gained boolean := false;
  v_iter_socket_gained boolean;
  v_socket_roll_chance numeric := 0.0025;
  v_comet_scrolls integer;
  v_success_chance numeric;
  v_upgraded boolean;
  v_rolls_attempted integer := 0;
  v_rolls_succeeded integer := 0;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_dry_streak integer;
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

  -- Gold Donation Event buff, if any, folded into the chance once here --
  -- the active event can't change mid-call, so this avoids 10 redundant
  -- lookups inside the loop below.
  v_socket_roll_chance := v_socket_roll_chance * public.gold_donation_socket_multiplier();

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
    v_iter_socket_gained := false;

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
        v_socket_ordinal := case v_socket_count when 0 then '1st' else '2nd' end;
        v_sockets := v_sockets || 'null'::jsonb;
        v_socket_gained := true;
        v_iter_socket_gained := true;

        insert into public.global_announcements (kind, character_name, message)
        values (
          'armor_socket',
          v_character_name,
          v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained its ' || v_socket_ordinal || ' socket!'
        );
      end if;
    end if;

    -- Recorded once per attempted roll -- including failed rolls -- so the
    -- streak reflects every Comet Scroll roll actually spent, not just
    -- successful ones.
    v_dry_streak := public.record_upgrade_attempt(v_character_id, 'level', v_upgraded, v_iter_socket_gained);
    if v_iter_socket_gained then
      insert into public.global_announcements (kind, character_name, message)
      values (
        'socket_dry_streak_end',
        v_character_name,
        v_character_name || '''s Level Upgrade dry streak of ' || v_dry_streak || ' has ended.'
      );
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

-- ============================================================================
-- 5. quality_upgrade_scroll -- streak recorded once per attempted roll in the batch
-- ============================================================================
create or replace function public.quality_upgrade_scroll(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_name text;
  v_current_tier text;
  v_next_tier text;
  v_template_id uuid;
  v_slot_type text;
  v_item_family text;
  v_item_name text;
  v_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_ordinal text;
  v_socket_gained boolean := false;
  v_iter_socket_gained boolean;
  v_socket_roll_chance numeric := 0.01;
  v_fallen_star_scrolls integer;
  v_success_chance numeric;
  v_upgraded boolean;
  v_rolls_attempted integer := 0;
  v_rolls_succeeded integer := 0;
  v_dry_streak integer;
  i integer;
begin
  select owner_id, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, fallen_star_scroll_count, name into v_account_id, v_fallen_star_scrolls, v_character_name
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_fallen_star_scrolls < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_star_scrolls');
  end if;

  select slot_type, item_family, required_level, name
  into v_slot_type, v_item_family, v_required_level, v_item_name
  from public.item_templates where id = v_template_id;

  v_next_tier := case v_current_tier
    when 'normal' then 'tempered'
    when 'tempered' then 'infused'
    when 'infused' then 'radiant'
    when 'radiant' then 'ascended'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  update public.characters set fallen_star_scroll_count = fallen_star_scroll_count - 1 where id = v_character_id
  returning fallen_star_scroll_count into v_fallen_star_scrolls;

  -- Gold Donation Event buff, if any, folded into the chance once here --
  -- same reasoning as level_upgrade_scroll above.
  v_socket_roll_chance := v_socket_roll_chance * public.gold_donation_socket_multiplier();

  for i in 1..10 loop
    v_next_tier := case v_current_tier
      when 'normal' then 'tempered'
      when 'tempered' then 'infused'
      when 'infused' then 'radiant'
      when 'radiant' then 'ascended'
      else null
    end;

    exit when v_next_tier is null; -- already ascended; remaining rolls wasted, no refund

    v_rolls_attempted := v_rolls_attempted + 1;
    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_current_tier, 'quality') / 100.0;
    v_upgraded := random() < v_success_chance;
    v_iter_socket_gained := false;

    if v_upgraded then
      v_rolls_succeeded := v_rolls_succeeded + 1;
      v_current_tier := v_next_tier;

      v_socket_count := jsonb_array_length(v_sockets);
      if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
         and v_socket_count < 2
         and random() < v_socket_roll_chance then
        v_socket_ordinal := case v_socket_count when 0 then '1st' else '2nd' end;
        v_sockets := v_sockets || 'null'::jsonb;
        v_socket_gained := true;
        v_iter_socket_gained := true;

        insert into public.global_announcements (kind, character_name, message)
        values (
          'armor_socket',
          v_character_name,
          v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained its ' || v_socket_ordinal || ' socket!'
        );
      end if;
    end if;

    -- Recorded once per attempted roll -- including failed rolls -- so the
    -- streak reflects every Fallen Star Scroll roll actually spent, not
    -- just successful ones.
    v_dry_streak := public.record_upgrade_attempt(v_character_id, 'quality', v_upgraded, v_iter_socket_gained);
    if v_iter_socket_gained then
      insert into public.global_announcements (kind, character_name, message)
      values (
        'socket_dry_streak_end',
        v_character_name,
        v_character_name || '''s Quality Upgrade dry streak of ' || v_dry_streak || ' has ended.'
      );
    end if;
  end loop;

  update public.item_instances
  set quality_tier = v_current_tier, sockets = v_sockets
  where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_rolls_succeeded > 0,
    'rolls_attempted', v_rolls_attempted,
    'rolls_succeeded', v_rolls_succeeded,
    'quality_tier', v_current_tier,
    'fallen_star_scrolls_remaining', v_fallen_star_scrolls,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

commit;
