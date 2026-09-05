-- Fixes VIP Auto-Use Bank Material (Forge) appearing to never spend from the
-- account Bank: the server-side draw in ensure_forge_currency
-- (20261220000000_vip_forge_bank_material.sql) was already correct --
-- verified against production, a real Forge attempt with 0 owned Comets/
-- Fallen Stars and the toggle on does decrement players.bank_comets/
-- bank_fallen_stars by the right amount each time -- but none of
-- quality_upgrade/level_upgrade/master_forge_upgrade ever forwarded that
-- draw back to the caller. Every other field they spend (fallen_stars_spent,
-- comets_remaining, etc.) is echoed in the response so the client can patch
-- its own store, but ensure_forge_currency's 'bank_used' key was computed
-- and then silently discarded -- the client's usePlayerRecordStore.bankComets/
-- bankFallenStars (shown as "Quantity: X" on AutoUseBankMaterialCard.tsx and
-- in BankSquares.tsx) had no way to ever learn the Bank had been drawn from,
-- so it stayed frozen at its last full players-row load, indistinguishable
-- from "not actually removing 1 per attempt" even though the DB was correct.
--
-- Fix: ensure_forge_currency now also returns 'bank_remaining' (the
-- post-decrement balance, read via the same UPDATE via RETURNING already in
-- the same transaction/row lock, so no separate stale-read risk). The three
-- callers forward it through their own response under a
-- currency-appropriate key; master_forge_upgrade already returned 'currency'
-- so it reuses that instead of a duplicate key. useForgeStore.ts (client)
-- is updated in the same change to apply it to usePlayerRecordStore.
--
-- All 4 functions keep their exact signatures -- plain create-or-replace,
-- no drop needed.
begin;

-- ============================================================================
-- 1. ensure_forge_currency -- adds 'bank_remaining' to its existing
--    'bank_used' key, both merged into the ensure_loose_currency passthrough
--    result exactly as before.
-- ============================================================================
create or replace function public.ensure_forge_currency(
  p_character_id uuid,
  p_currency_type text,
  p_amount_needed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_loose integer;
  v_account_id uuid;
  v_vip_expires_at timestamptz;
  v_automation jsonb;
  v_bank_balance integer;
  v_shortfall integer;
  v_bank_used integer;
begin
  if p_currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  -- Step 1: same scroll-unbundling ensure_loose_currency already does.
  v_result := public.ensure_loose_currency(p_character_id, p_currency_type, p_amount_needed);
  if not (v_result ->> 'ok')::boolean then
    return v_result;
  end if;

  select account_id, vip_expires_at, vip_automation_settings,
         case when p_currency_type = 'comet' then comet_count else fallen_star_count end
  into v_account_id, v_vip_expires_at, v_automation, v_loose
  from public.characters
  where id = p_character_id;

  if v_loose >= p_amount_needed then
    return v_result;
  end if;

  -- Not VIP, or VIP but this currency isn't the one selected as the
  -- auto-use material -- fall through unchanged; the caller's own
  -- affordability check reports the ordinary "not enough" error.
  if v_account_id is null or v_vip_expires_at is null or v_vip_expires_at <= now()
     or coalesce(v_automation ->> 'autoUseBankMaterial', '') <> p_currency_type then
    return v_result;
  end if;

  v_shortfall := p_amount_needed - v_loose;

  perform 1 from public.players where id = v_account_id for update;

  if p_currency_type = 'comet' then
    select bank_comets into v_bank_balance from public.players where id = v_account_id;
  else
    select bank_fallen_stars into v_bank_balance from public.players where id = v_account_id;
  end if;

  v_bank_used := least(v_shortfall, coalesce(v_bank_balance, 0));
  if v_bank_used <= 0 then
    return v_result;
  end if;

  if p_currency_type = 'comet' then
    update public.characters set comet_count = comet_count + v_bank_used where id = p_character_id;
    update public.players set bank_comets = bank_comets - v_bank_used where id = v_account_id
    returning bank_comets into v_bank_balance;
  else
    update public.characters set fallen_star_count = fallen_star_count + v_bank_used where id = p_character_id;
    update public.players set bank_fallen_stars = bank_fallen_stars - v_bank_used where id = v_account_id
    returning bank_fallen_stars into v_bank_balance;
  end if;

  return v_result || jsonb_build_object('bank_used', v_bank_used, 'bank_remaining', v_bank_balance);
end;
$$;

-- ============================================================================
-- 2. quality_upgrade -- unchanged body except the final return object now
--    forwards ensure_forge_currency's bank_used/bank_remaining under
--    fallen_star_bank_used/fallen_star_bank_remaining (this function only
--    ever draws Fallen Stars).
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

  if v_slot_type in ('promotion-material', 'material') or v_item_family = 'pickaxe' then
    return jsonb_build_object('ok', false, 'error', 'no_quality_upgrade_path');
  end if;

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

  v_ensure_result := public.ensure_forge_currency(v_character_id, 'fallen_star', v_cost);
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
    'fallen_star_bank_used', coalesce((v_ensure_result->>'bank_used')::integer, 0),
    'fallen_star_bank_remaining', (v_ensure_result->>'bank_remaining')::integer,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- 3. level_upgrade -- same treatment, comet_bank_used/comet_bank_remaining
--    (this function only ever draws Comets).
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

  -- Weapons at level 120+ are Master-Forge-exclusive from here -- checked
  -- after already_max_level so a maxed-out (level 130) weapon still reports
  -- that instead of pointing at Master Forge for nothing.
  if v_slot_type = 'weapon' and v_required_level >= 120 then
    return jsonb_build_object('ok', false, 'error', 'weapon_requires_master_forge', 'level', v_current_level);
  end if;

  if v_is_equipped and v_next_required_level > v_character_level then
    return jsonb_build_object(
      'ok', false,
      'error', 'exceeds_character_level',
      'result_level', v_next_required_level,
      'character_level', v_character_level
    );
  end if;

  v_ensure_result := public.ensure_forge_currency(v_character_id, 'comet', v_cost);
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
    'comet_bank_used', coalesce((v_ensure_result->>'bank_used')::integer, 0),
    'comet_bank_remaining', (v_ensure_result->>'bank_remaining')::integer,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- 4. master_forge_upgrade -- same treatment; already returns 'currency', so
--    reuses that field instead of a duplicate 'bank_currency' key.
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
  v_currency text;
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

  if upgrade_type = 'quality' and (v_slot_type in ('promotion-material', 'material') or v_item_family = 'pickaxe') then
    return jsonb_build_object('ok', false, 'error', 'no_quality_upgrade_path');
  end if;

  if upgrade_type = 'quality' then
    v_currency := 'fallen_star';

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
    -- Weapon-only, level-120+ Fallen Star cost -- Master Forge is the *only*
    -- way to Level Upgrade a weapon past 120, at a flat 1 Fallen Star per
    -- level (no cost formula -- see this migration's header).
    v_currency := case when v_slot_type = 'weapon' and v_required_level >= 120 then 'fallen_star' else 'comet' end;

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

  if upgrade_type = 'level' and v_currency = 'fallen_star' then
    v_cost := 1;
  else
    v_cost := ceil((1.0 / v_success_chance) * 1.5);
  end if;

  v_ensure_result := public.ensure_forge_currency(v_character_id, v_currency, v_cost);
  if not (v_ensure_result->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room_to_unbundle', 'cost', v_cost);
  end if;

  if v_currency = 'fallen_star' then
    select fallen_star_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_stars', 'cost', v_cost, 'fallen_stars', v_currency_owned);
    end if;
    update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id
    returning fallen_star_count into v_currency_owned;
    select fallen_star_scroll_count into v_scrolls_remaining from public.characters where id = v_character_id;
  else
    select comet_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_comets', 'cost', v_cost, 'comets', v_currency_owned);
    end if;
    update public.characters set comet_count = comet_count - v_cost where id = v_character_id
    returning comet_count into v_currency_owned;
    select comet_scroll_count into v_scrolls_remaining from public.characters where id = v_character_id;
  end if;

  if upgrade_type = 'quality' then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  else
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
    'currency', v_currency,
    'quality_tier', case when upgrade_type = 'quality' then v_next_tier else v_quality_tier end,
    'level', case when upgrade_type = 'level' then v_next_required_level else v_current_level end,
    'template_id', case when upgrade_type = 'level' then v_next_template_id else v_template_id end,
    'fallen_stars_remaining', case when v_currency = 'fallen_star' then v_currency_owned else null end,
    'comets_remaining', case when v_currency = 'comet' then v_currency_owned else null end,
    'scrolls_remaining', v_scrolls_remaining,
    'bank_used', coalesce((v_ensure_result->>'bank_used')::integer, 0),
    'bank_remaining', (v_ensure_result->>'bank_remaining')::integer,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

commit;
