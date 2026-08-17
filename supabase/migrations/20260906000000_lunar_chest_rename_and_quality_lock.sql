-- Lunar Chest (2026-09-06, requested by the user) -- renames "Moon Box" and
-- closes a bug where it (and every other promotion-material item sharing its
-- slot_type -- Umbrite Ore, Jade Shard, Opaline Gem) could be dropped into
-- any Forge tool's Quality Upgrade slot and successfully "temper" into a
-- nonsensical "Tempered Lunar Chest" etc. quality_upgrade/
-- quality_upgrade_scroll/master_forge_upgrade's quality branch had no
-- slot_type guard at all -- unlike level_upgrade, which already refuses
-- items with no upgrade chain via its own (different) check. Guard added
-- right after each function's item_templates lookup, before any currency is
-- spent, so a rejected attempt costs nothing.
--
-- Same-signature create-or-replace on quality_upgrade/quality_upgrade_scroll/
-- master_forge_upgrade -- no drop needed. Bodies otherwise unchanged copies
-- of 20260905000000_character_upgrade_stats.sql's definitions.
--
-- draw_lucky_ticket/draw_lucky_ticket_bulk also re-created verbatim from
-- 20260901061000_lucky_ticket_room_check_excludes_listed_and_mailed.sql
-- (current latest definitions), just swapping the 'Moon Box' name lookup and
-- announcement text for 'Lunar Chest'. The 'moon_box' internal kind slug is
-- left as-is (pick_lucky_reward's weight table, useLuckyStore.ts's union
-- type, LuckyPanel.tsx's switch) -- it's an internal identifier, not shown to
-- players.
begin;

update public.item_templates set name = 'Lunar Chest' where name = 'Moon Box';

update public.promotion_tiers
set items_required = '[{"kind":"item","name":"Lunar Chest","quantity":1}]'::jsonb
where class = 'hunter' and level = 110;

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

  if v_slot_type = 'promotion-material' then
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

  if v_upgraded then
    v_dry_streak := public.record_successful_upgrade(v_character_id, 'quality', v_socket_gained);
    if v_socket_gained then
      insert into public.global_announcements (kind, character_name, message)
      values (
        'socket_dry_streak_end',
        v_character_name,
        v_character_name || '''s Quality Upgrade dry streak of ' || v_dry_streak || ' has ended.'
      );
    end if;
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
-- 2. master_forge_upgrade
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

  if upgrade_type = 'quality' and v_slot_type = 'promotion-material' then
    return jsonb_build_object('ok', false, 'error', 'no_quality_upgrade_path');
  end if;

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

  v_dry_streak := public.record_successful_upgrade(v_character_id, upgrade_type, v_socket_gained);
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
-- 3. quality_upgrade_scroll -- streak recorded once per successful roll in the batch
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

  if v_slot_type = 'promotion-material' then
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

    if v_upgraded then
      v_rolls_succeeded := v_rolls_succeeded + 1;
      v_current_tier := v_next_tier;

      v_iter_socket_gained := false;
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

      v_dry_streak := public.record_successful_upgrade(v_character_id, 'quality', v_iter_socket_gained);
      if v_iter_socket_gained then
        insert into public.global_announcements (kind, character_name, message)
        values (
          'socket_dry_streak_end',
          v_character_name,
          v_character_name || '''s Quality Upgrade dry streak of ' || v_dry_streak || ' has ended.'
        );
      end if;
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

-- ============================================================================
-- 4. draw_lucky_ticket -- verbatim copy of 20260901061000's definition, 'Moon
-- Box' name lookup/announcement text swapped for 'Lunar Chest'.
-- ============================================================================
create or replace function public.draw_lucky_ticket(p_character_id uuid, p_card_index integer, p_use_ticket boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_character_class text;
  v_free_claimed_at timestamptz;
  v_gold integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_comet_box_count integer;
  v_lottery_ticket_count integer;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_equipped_ids uuid[];
  v_free_available boolean;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_board jsonb := '[]'::jsonb;
  v_won jsonb;
  v_kind text;
  v_amount integer;
  v_new_gold integer;
  v_new_comet_count integer;
  v_new_fallen_star_count integer;
  v_new_comet_scroll_count integer;
  v_new_fallen_star_scroll_count integer;
  v_new_comet_box_count integer;
  v_new_lottery_ticket_count integer;
  v_next_free_at timestamptz;
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_occupied integer;
  v_needs_room boolean;
  v_stone_key text;
  v_stone_owned integer;
  v_gem_id text;
  v_gem_tier text;
  v_gem_key text;
  v_gem_owned integer;
  v_template_id uuid;
  v_required_level integer;
  v_slot_type text;
  v_new_item item_instances%rowtype;
  v_granted_item jsonb;
  v_item_name text;
  i integer;
begin
  if p_card_index is null or p_card_index < 0 or p_card_index > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_index');
  end if;

  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count, comet_box_count,
         lucky_free_ticket_claimed_at, lottery_ticket_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_comet_box_count,
       v_free_claimed_at, v_lottery_ticket_count, v_character_name, v_character_class, v_composition_stones, v_gems,
       v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if p_use_ticket then
    if coalesce(v_lottery_ticket_count, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_lottery_tickets');
    end if;
    v_payment := 'lottery_ticket';
  else
    v_free_available := v_free_claimed_at is null or now() - v_free_claimed_at >= interval '4 hours';

    if v_free_available then
      v_payment := 'free';
    else
      v_payment := 'ascension_points';
      select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
      if v_ap_balance < 20 then
        v_next_free_at := v_free_claimed_at + interval '4 hours';
        return jsonb_build_object(
          'ok', false, 'error', 'not_enough_ap', 'cost', 20, 'ascension_points', v_ap_balance,
          'next_free_ticket_at', v_next_free_at
        );
      end if;
    end if;
  end if;

  for i in 0..8 loop
    v_board := v_board || jsonb_build_array(public.pick_lucky_reward());
  end loop;

  v_won := v_board -> p_card_index;
  v_kind := v_won ->> 'kind';
  v_amount := (v_won ->> 'amount')::integer;

  v_needs_room := v_kind in (
    'money_bag', 'gem_bag', 'composition_stone', 'moon_box',
    'gem_tempered_drake', 'gem_tempered_ember', 'gem_tempered_bastion', 'gem_tempered_iris',
    'gem_ascended_drake', 'gem_ascended_ember', 'gem_ascended_bastion', 'gem_ascended_iris',
    'gear_radiant_bow', 'gear_radiant_coat', 'gear_ascended_random'
  );

  if v_needs_room then
    select count(*) into v_gear_count
    from public.item_instances
    where owner_id = p_character_id
      and location <> 'bank'
      and not (id = any(v_equipped_ids))
      and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
      and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

    select coalesce(sum((value)::integer), 0) into v_stone_count
    from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

    select coalesce(sum((value)::integer), 0) into v_gem_count
    from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = p_character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count + v_comet_box_count;

    if v_occupied >= 40 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_room');
    end if;
  end if;

  v_new_lottery_ticket_count := v_lottery_ticket_count;

  if v_payment = 'lottery_ticket' then
    v_new_lottery_ticket_count := v_lottery_ticket_count - 1;
    update public.characters set lottery_ticket_count = v_new_lottery_ticket_count where id = p_character_id;
  elsif v_payment = 'ascension_points' then
    update public.players set ascension_points = ascension_points - 20 where id = v_account_id
    returning ascension_points into v_new_ap;
  else
    update public.characters set lucky_free_ticket_claimed_at = now() where id = p_character_id;
  end if;

  v_new_gold := v_gold;
  v_new_comet_count := v_comet_count;
  v_new_fallen_star_count := v_fallen_star_count;
  v_new_comet_scroll_count := v_comet_scroll_count;
  v_new_fallen_star_scroll_count := v_fallen_star_scroll_count;
  v_new_comet_box_count := v_comet_box_count;

  if v_kind = 'comet' then
    v_new_comet_count := v_comet_count + 1;
  elsif v_kind = 'comet_box' then
    v_new_comet_box_count := v_comet_box_count + 1;
  elsif v_kind = 'fallen_star' then
    v_new_fallen_star_count := v_fallen_star_count + 1;
  elsif v_kind = 'comet_scroll' then
    v_new_comet_scroll_count := v_comet_scroll_count + 1;
  elsif v_kind = 'fallen_star_scroll' then
    v_new_fallen_star_scroll_count := v_fallen_star_scroll_count + 1;
  elsif v_kind = 'money_bag' then
    select id, slot_type into v_template_id, v_slot_type
    from public.item_templates where name = 'Class ' || v_amount || ' Money Bag';

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 1), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gem_bag' then
    select id, slot_type into v_template_id, v_slot_type from public.item_templates where name = 'Random Gem Bag';

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 1), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'moon_box' then
    select id, required_level, slot_type into v_template_id, v_required_level, v_slot_type
    from public.item_templates where name = 'Lunar Chest';

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'normal', v_required_level, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'composition_stone' then
    v_stone_key := v_amount::text;
    v_stone_owned := coalesce((v_composition_stones ->> v_stone_key)::integer, 0);
    v_composition_stones := jsonb_set(coalesce(v_composition_stones, '{}'::jsonb), array[v_stone_key], to_jsonb(v_stone_owned + 1));
    update public.characters set composition_stones = v_composition_stones where id = p_character_id;
  elsif v_kind like 'gem\_tempered\_%' escape '\' or v_kind like 'gem\_ascended\_%' escape '\' then
    v_gem_id := split_part(v_kind, '_', 3);
    v_gem_tier := split_part(v_kind, '_', 2);
    v_gem_key := v_gem_id || '_' || v_gem_tier;
    v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
    v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned + 1));
    update public.characters set gems = v_gems where id = p_character_id;
  elsif v_kind = 'gear_radiant_bow' then
    select id, slot_type into v_template_id, v_slot_type
    from public.item_templates where name = 'Ranger''s Bow' and required_level = 15;

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 15), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gear_radiant_coat' then
    select id, slot_type into v_template_id, v_slot_type
    from public.item_templates where name = 'Fawnhide Coat' and required_level = 15;

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 15), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gear_ascended_random' then
    v_template_id := public.pick_ascended_reward_template(v_character_class);

    if v_template_id is not null then
      select required_level, slot_type into v_required_level, v_slot_type from public.item_templates where id = v_template_id;

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (
        v_template_id, p_character_id, 'ascended', v_required_level, '[]'::jsonb,
        coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
      )
      returning * into v_new_item;
      v_granted_item := to_jsonb(v_new_item);
    end if;
  end if;

  if v_kind = 'comet_box' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_comet_box', v_character_name, v_character_name || ' won a Comet Box from LL!');
  elsif v_kind = 'moon_box' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_moon_box', v_character_name, v_character_name || ' won a Lunar Chest from LL!');
  elsif v_kind = 'comet_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_comet_scroll', v_character_name, v_character_name || ' won a Comet Scroll from LL!');
  elsif v_kind = 'fallen_star_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star_scroll', v_character_name, v_character_name || ' won a Fallen Star Scroll from LL!');
  elsif v_kind = 'fallen_star' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star', v_character_name, v_character_name || ' won a Fallen Star from LL!');
  elsif v_kind like 'gem\_tempered\_%' escape '\' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gem_tempered', v_character_name, v_character_name || ' won a Tempered ' || initcap(v_gem_id) || ' Gem from LL!');
  elsif v_kind like 'gem\_ascended\_%' escape '\' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gem_ascended', v_character_name, v_character_name || ' won an Ascended ' || initcap(v_gem_id) || ' Gem from LL!');
  elsif v_kind = 'gear_radiant_bow' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_radiant_bow', v_character_name, v_character_name || ' won a Radiant Ranger''s Bow from LL!');
  elsif v_kind = 'gear_radiant_coat' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_radiant_coat', v_character_name, v_character_name || ' won a Radiant Fawnhide Coat from LL!');
  elsif v_kind = 'gear_ascended_random' and v_granted_item is not null then
    select name into v_item_name from public.item_templates where id = v_template_id;
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_ascended_random', v_character_name, v_character_name || ' won an Ascended ' || coalesce(v_item_name, 'item') || ' from LL!');
  end if;

  update public.characters
  set
    gold = v_new_gold,
    comet_count = v_new_comet_count,
    fallen_star_count = v_new_fallen_star_count,
    comet_scroll_count = v_new_comet_scroll_count,
    fallen_star_scroll_count = v_new_fallen_star_scroll_count,
    comet_box_count = v_new_comet_box_count
  where id = p_character_id;

  select lucky_free_ticket_claimed_at + interval '4 hours' into v_next_free_at
  from public.characters where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'board', v_board,
    'won_index', p_card_index,
    'payment', v_payment,
    'cost', case when v_payment = 'ascension_points' then 20 when v_payment = 'lottery_ticket' then 1 else 0 end,
    'character', jsonb_build_object(
      'gold', v_new_gold,
      'comet_count', v_new_comet_count,
      'fallen_star_count', v_new_fallen_star_count,
      'comet_scroll_count', v_new_comet_scroll_count,
      'fallen_star_scroll_count', v_new_fallen_star_scroll_count,
      'comet_box_count', v_new_comet_box_count,
      'lottery_ticket_count', v_new_lottery_ticket_count
    ),
    'ascension_points', v_new_ap,
    'next_free_ticket_at', v_next_free_at,
    'granted_item', v_granted_item,
    'composition_stones', v_composition_stones,
    'gems', v_gems
  );
end;
$$;

-- ============================================================================
-- 5. draw_lucky_ticket_bulk -- same swap as above
-- ============================================================================
create or replace function public.draw_lucky_ticket_bulk(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_character_class text;
  v_gold integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_comet_box_count integer;
  v_lottery_ticket_count integer;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_equipped_ids uuid[];
  v_ap_balance integer;
  v_new_ap integer;
  v_board jsonb := '[]'::jsonb;
  v_kind text;
  v_amount integer;
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_occupied integer;
  v_needed_room integer := 0;
  v_stone_key text;
  v_stone_owned integer;
  v_gem_id text;
  v_gem_tier text;
  v_gem_key text;
  v_gem_owned integer;
  v_template_id uuid;
  v_required_level integer;
  v_slot_type text;
  v_new_item item_instances%rowtype;
  v_granted_items jsonb := '[]'::jsonb;
  v_item_name text;
  v_entry jsonb;
  i integer;
begin
  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count, comet_box_count,
         lottery_ticket_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_comet_box_count,
       v_lottery_ticket_count, v_character_name, v_character_class, v_composition_stones, v_gems,
       v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
  if v_ap_balance < 160 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_ap', 'cost', 160, 'ascension_points', v_ap_balance);
  end if;

  for i in 0..8 loop
    v_board := v_board || jsonb_build_array(public.pick_lucky_reward());
  end loop;

  select count(*) into v_needed_room
  from jsonb_array_elements(v_board) as e
  where (e ->> 'kind') in (
    'money_bag', 'gem_bag', 'composition_stone', 'moon_box',
    'gem_tempered_drake', 'gem_tempered_ember', 'gem_tempered_bastion', 'gem_tempered_iris',
    'gem_ascended_drake', 'gem_ascended_ember', 'gem_ascended_bastion', 'gem_ascended_iris',
    'gear_radiant_bow', 'gear_radiant_coat', 'gear_ascended_random'
  );

  if v_needed_room > 0 then
    select count(*) into v_gear_count
    from public.item_instances
    where owner_id = p_character_id
      and location <> 'bank'
      and not (id = any(v_equipped_ids))
      and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
      and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

    select coalesce(sum((value)::integer), 0) into v_stone_count
    from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

    select coalesce(sum((value)::integer), 0) into v_gem_count
    from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = p_character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count + v_comet_box_count;

    if v_occupied + v_needed_room > 40 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_room');
    end if;
  end if;

  update public.players set ascension_points = ascension_points - 160 where id = v_account_id
  returning ascension_points into v_new_ap;

  for i in 0..8 loop
    v_entry := v_board -> i;
    v_kind := v_entry ->> 'kind';
    v_amount := (v_entry ->> 'amount')::integer;
    v_template_id := null;

    if v_kind = 'comet' then
      v_comet_count := v_comet_count + 1;
    elsif v_kind = 'comet_box' then
      v_comet_box_count := v_comet_box_count + 1;
    elsif v_kind = 'fallen_star' then
      v_fallen_star_count := v_fallen_star_count + 1;
    elsif v_kind = 'comet_scroll' then
      v_comet_scroll_count := v_comet_scroll_count + 1;
    elsif v_kind = 'fallen_star_scroll' then
      v_fallen_star_scroll_count := v_fallen_star_scroll_count + 1;
    elsif v_kind = 'money_bag' then
      select id, slot_type into v_template_id, v_slot_type
      from public.item_templates where name = 'Class ' || v_amount || ' Money Bag';

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 1), 0))
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    elsif v_kind = 'gem_bag' then
      select id, slot_type into v_template_id, v_slot_type from public.item_templates where name = 'Random Gem Bag';

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 1), 0))
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    elsif v_kind = 'moon_box' then
      select id, required_level, slot_type into v_template_id, v_required_level, v_slot_type
      from public.item_templates where name = 'Lunar Chest';

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (v_template_id, p_character_id, 'normal', v_required_level, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0))
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    elsif v_kind = 'composition_stone' then
      v_stone_key := v_amount::text;
      v_stone_owned := coalesce((v_composition_stones ->> v_stone_key)::integer, 0);
      v_composition_stones := jsonb_set(coalesce(v_composition_stones, '{}'::jsonb), array[v_stone_key], to_jsonb(v_stone_owned + 1));
    elsif v_kind like 'gem\_tempered\_%' escape '\' or v_kind like 'gem\_ascended\_%' escape '\' then
      v_gem_id := split_part(v_kind, '_', 3);
      v_gem_tier := split_part(v_kind, '_', 2);
      v_gem_key := v_gem_id || '_' || v_gem_tier;
      v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
      v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned + 1));
    elsif v_kind = 'gear_radiant_bow' then
      select id, slot_type into v_template_id, v_slot_type
      from public.item_templates where name = 'Ranger''s Bow' and required_level = 15;

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 15), 0))
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    elsif v_kind = 'gear_radiant_coat' then
      select id, slot_type into v_template_id, v_slot_type
      from public.item_templates where name = 'Fawnhide Coat' and required_level = 15;

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 15), 0))
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    elsif v_kind = 'gear_ascended_random' then
      v_template_id := public.pick_ascended_reward_template(v_character_class);

      if v_template_id is not null then
        select required_level, slot_type into v_required_level, v_slot_type from public.item_templates where id = v_template_id;

        insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
        values (
          v_template_id, p_character_id, 'ascended', v_required_level, '[]'::jsonb,
          coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
        )
        returning * into v_new_item;
        v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
      end if;
    end if;

    if v_kind = 'comet_box' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_comet_box', v_character_name, v_character_name || ' won a Comet Box from LL!');
    elsif v_kind = 'moon_box' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_moon_box', v_character_name, v_character_name || ' won a Lunar Chest from LL!');
    elsif v_kind = 'comet_scroll' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_comet_scroll', v_character_name, v_character_name || ' won a Comet Scroll from LL!');
    elsif v_kind = 'fallen_star_scroll' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_fallen_star_scroll', v_character_name, v_character_name || ' won a Fallen Star Scroll from LL!');
    elsif v_kind = 'fallen_star' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_fallen_star', v_character_name, v_character_name || ' won a Fallen Star from LL!');
    elsif v_kind like 'gem\_tempered\_%' escape '\' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_gem_tempered', v_character_name, v_character_name || ' won a Tempered ' || initcap(v_gem_id) || ' Gem from LL!');
    elsif v_kind like 'gem\_ascended\_%' escape '\' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_gem_ascended', v_character_name, v_character_name || ' won an Ascended ' || initcap(v_gem_id) || ' Gem from LL!');
    elsif v_kind = 'gear_radiant_bow' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_gear_radiant_bow', v_character_name, v_character_name || ' won a Radiant Ranger''s Bow from LL!');
    elsif v_kind = 'gear_radiant_coat' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_gear_radiant_coat', v_character_name, v_character_name || ' won a Radiant Fawnhide Coat from LL!');
    elsif v_kind = 'gear_ascended_random' and v_template_id is not null then
      select name into v_item_name from public.item_templates where id = v_template_id;
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_gear_ascended_random', v_character_name, v_character_name || ' won an Ascended ' || coalesce(v_item_name, 'item') || ' from LL!');
    end if;
  end loop;

  update public.characters
  set
    gold = v_gold,
    comet_count = v_comet_count,
    fallen_star_count = v_fallen_star_count,
    comet_scroll_count = v_comet_scroll_count,
    fallen_star_scroll_count = v_fallen_star_scroll_count,
    comet_box_count = v_comet_box_count,
    composition_stones = v_composition_stones,
    gems = v_gems
  where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'board', v_board,
    'cost', 160,
    'character', jsonb_build_object(
      'gold', v_gold,
      'comet_count', v_comet_count,
      'fallen_star_count', v_fallen_star_count,
      'comet_scroll_count', v_comet_scroll_count,
      'fallen_star_scroll_count', v_fallen_star_scroll_count,
      'comet_box_count', v_comet_box_count,
      'lottery_ticket_count', v_lottery_ticket_count
    ),
    'ascension_points', v_new_ap,
    'granted_items', v_granted_items,
    'composition_stones', v_composition_stones,
    'gems', v_gems
  );
end;
$$;

commit;
