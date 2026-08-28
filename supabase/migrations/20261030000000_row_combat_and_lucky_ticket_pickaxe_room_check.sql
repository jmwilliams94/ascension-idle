-- Same root cause and fix as 20261029000000_resolve_combat_gather_state_
-- pickaxe_room_check.sql: 20261024000000_pickaxe_dedicated_equip_slot.sql
-- re-introduced characters.equipped_pickaxe_id as its own dedicated equip
-- column, explicitly disclosing that it only swept occupied_inventory_slots
-- and resolve_mining_gather_state, leaving every other room-check-shaped
-- function's own independent equipped-ids exclusion array stale (missing
-- the Pickaxe pointer). resolve_row_combat_gather_state (Row Combat) and
-- draw_lucky_ticket/draw_lucky_ticket_bulk (Lucky Lad) are three more —
-- each counts a character's equipped Pickaxe as a real, unequipped
-- Inventory item, a phantom occupied slot invisible in the client's own
-- Inventory grid.
--
-- Full bodies copied verbatim from each function's current latest
-- definition (verified via `create or replace function` grep across every
-- migration) with only the exclusion array widened. No signature changes,
-- so plain create-or-replace is safe.
begin;

-- ============================================================================
-- 1. resolve_row_combat_gather_state -- full body from
--    20260904020000_row_combat_gold_donation_event.sql. Only change: the
--    gear_count room-check query's exclusion array now also drops
--    equipped_pickaxe_id. The equipped_items stat query keeps using
--    v_equipped_ids_no_quiver unchanged -- Pickaxe isn't in EQUIP_SLOTS and
--    has no base_stats relevant to combat (see equipmentBonus.ts).
-- ============================================================================
create or replace function public.resolve_row_combat_gather_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_old_character jsonb;
  v_old_resolved_at timestamptz;
  v_new_resolved_at timestamptz := now();
  v_account_id uuid;
  v_selected_monster_id text;
  v_row_slots jsonb;
  v_rows_updated integer;
  v_claimed boolean;
  v_monster_ids text[];
  v_enemy_types jsonb;
  v_equipped_items jsonb;
  v_equipped_ids_no_quiver uuid[];
  v_equipped_ids_room_check uuid[];
  v_gear_count integer;
  v_potion_count integer;
  v_character_kills jsonb;
  v_pet_monster_ids text[];
  v_player jsonb;
  v_active_event jsonb;
begin
  select to_jsonb(c), c.row_combat_last_resolved_at, c.account_id, c.selected_monster_id, c.row_slots
  into v_old_character, v_old_resolved_at, v_account_id, v_selected_monster_id, v_row_slots
  from public.characters c
  where c.id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.characters
  set row_combat_last_resolved_at = v_new_resolved_at
  where id = p_character_id and row_combat_last_resolved_at = v_old_resolved_at;
  get diagnostics v_rows_updated = row_count;
  v_claimed := v_rows_updated > 0;

  if not v_claimed then
    return jsonb_build_object('ok', true, 'claimed', false, 'character', v_old_character);
  end if;

  select coalesce(array_agg(distinct value ->> 'monster_id'), array[]::text[])
  into v_monster_ids
  from jsonb_array_elements(coalesce(v_row_slots, '[]'::jsonb)) as value
  where value ->> 'monster_id' is not null;

  select coalesce(jsonb_object_agg(e.id, to_jsonb(e)), '{}'::jsonb)
  into v_enemy_types
  from public.enemy_types e
  where e.id = any(v_monster_ids);

  v_equipped_ids_no_quiver := array_remove(array[
    (v_old_character->>'equipped_weapon_id')::uuid,
    (v_old_character->>'equipped_ring_id')::uuid,
    (v_old_character->>'equipped_necklace_id')::uuid,
    (v_old_character->>'equipped_boots_id')::uuid,
    (v_old_character->>'equipped_hat_id')::uuid,
    (v_old_character->>'equipped_coat_id')::uuid
  ], null);

  -- Room-check only: layers the quiver AND the Pickaxe's own dedicated equip
  -- pointer on top of the stat-query array above.
  v_equipped_ids_room_check := array_remove(
    array[
      (v_old_character->>'equipped_weapon_id')::uuid,
      (v_old_character->>'equipped_ring_id')::uuid,
      (v_old_character->>'equipped_necklace_id')::uuid,
      (v_old_character->>'equipped_boots_id')::uuid,
      (v_old_character->>'equipped_hat_id')::uuid,
      (v_old_character->>'equipped_coat_id')::uuid,
      (v_old_character->>'equipped_quiver_id')::uuid,
      (v_old_character->>'equipped_pickaxe_id')::uuid
    ],
    null
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ii.id,
    'quality_tier', ii.quality_tier,
    'template_id', ii.template_id,
    'composition_level', ii.composition_level,
    'durability', ii.durability,
    'base_stats', it.base_stats,
    'slot_type', it.slot_type,
    'required_level', it.required_level,
    'sockets', ii.sockets
  )), '[]'::jsonb)
  into v_equipped_items
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = any(v_equipped_ids_no_quiver);

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids_room_check));

  select count(*) into v_potion_count
  from public.potion_stacks
  where character_id = p_character_id and count > 0;

  select coalesce(jsonb_object_agg(k.monster_id, to_jsonb(k)), '{}'::jsonb)
  into v_character_kills
  from public.character_monster_kills k
  where k.character_id = p_character_id and k.monster_id = any(v_monster_ids);

  select coalesce(array_agg(monster_id), array[]::text[])
  into v_pet_monster_ids
  from public.account_pets
  where account_id = v_account_id and monster_id = any(v_monster_ids);

  select to_jsonb(p) into v_player from public.players p where p.id = v_account_id;

  select jsonb_build_object('category', gp.buff_category, 'multiplier', gp.buff_multiplier)
  into v_active_event
  from public.gold_donation_state gs
  join public.gold_donation_pools gp on gp.id = gs.current_pool_id
  where gs.id = 1 and gp.status = 'active' and now() < gp.buff_ends_at;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'claimed_at', v_new_resolved_at,
    'restore_at', v_old_resolved_at,
    'character', v_old_character,
    'row_slots', coalesce(v_row_slots, '[]'::jsonb),
    'enemy_types', v_enemy_types,
    'equipped_items', v_equipped_items,
    'gear_count', v_gear_count,
    'potion_count', v_potion_count,
    'character_kills', v_character_kills,
    'pet_monster_ids', v_pet_monster_ids,
    'player', v_player,
    'active_event', v_active_event
  );
end;
$$;

revoke all on function public.resolve_row_combat_gather_state(uuid) from public;
grant execute on function public.resolve_row_combat_gather_state(uuid) to service_role;

-- ============================================================================
-- 2. draw_lucky_ticket / draw_lucky_ticket_bulk -- full bodies from
--    20261022000000_lucky_free_ticket_account_wide.sql (single-draw, the
--    latest definition) and 20261012000000_lucky_announcement_list_trim.sql
--    (bulk-draw, the latest definition -- untouched by the account-wide
--    cooldown migration). Only change in each: the room-check's
--    v_equipped_ids gains equipped_pickaxe_id.
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
  v_vip_token_count integer;
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
  v_new_vip_token_count integer;
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
         lottery_ticket_count, vip_token_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_comet_box_count,
       v_lottery_ticket_count, v_vip_token_count, v_character_name, v_character_class, v_composition_stones, v_gems,
       v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select lucky_free_ticket_claimed_at, ascension_points into v_free_claimed_at, v_ap_balance
  from public.players where id = v_account_id for update;

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
      and not (id = any(v_equipped_ids));

    select coalesce(sum((value)::integer), 0) into v_stone_count
    from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

    select coalesce(sum((value)::integer), 0) into v_gem_count
    from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = p_character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count + v_comet_box_count + v_vip_token_count;

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
    v_free_claimed_at := now();
    update public.players set lucky_free_ticket_claimed_at = v_free_claimed_at where id = v_account_id;
  end if;

  v_new_gold := v_gold;
  v_new_comet_count := v_comet_count;
  v_new_fallen_star_count := v_fallen_star_count;
  v_new_comet_scroll_count := v_comet_scroll_count;
  v_new_fallen_star_scroll_count := v_fallen_star_scroll_count;
  v_new_comet_box_count := v_comet_box_count;
  v_new_vip_token_count := v_vip_token_count;

  if v_kind = 'comet' then
    v_new_comet_count := v_comet_count + 1;
  elsif v_kind = 'comet_box' then
    v_new_comet_box_count := v_comet_box_count + 1;
  elsif v_kind = 'vip_token' then
    v_new_vip_token_count := v_vip_token_count + 1;
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
    from public.item_templates where name = 'Moon Box';

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
  elsif v_kind = 'vip_token' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_vip_token', v_character_name, v_character_name || ' won a VIP Token from LL!');
  elsif v_kind = 'fallen_star_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star_scroll', v_character_name, v_character_name || ' won a Fallen Star Scroll from LL!');
  elsif v_kind = 'fallen_star' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star', v_character_name, v_character_name || ' won a Fallen Star from LL!');
  elsif v_kind = 'money_bag' and v_amount >= 6 then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_money_bag', v_character_name, v_character_name || ' won a Class ' || v_amount || ' Money Bag from LL!');
  elsif v_kind = 'composition_stone' and v_amount >= 5 then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_stone', v_character_name, v_character_name || ' won a +' || v_amount || ' Stone from LL!');
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
    comet_box_count = v_new_comet_box_count,
    vip_token_count = v_new_vip_token_count
  where id = p_character_id;

  select lucky_free_ticket_claimed_at + interval '4 hours' into v_next_free_at
  from public.players where id = v_account_id;

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
      'lottery_ticket_count', v_new_lottery_ticket_count,
      'vip_token_count', v_new_vip_token_count
    ),
    'ascension_points', v_new_ap,
    'next_free_ticket_at', v_next_free_at,
    'granted_item', v_granted_item,
    'composition_stones', v_composition_stones,
    'gems', v_gems
  );
end;
$$;

create or replace function public.draw_lucky_ticket_bulk(p_character_id uuid, p_use_tickets boolean default false)
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
  v_vip_token_count integer;
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
  v_pending_announcements jsonb := '[]'::jsonb;
  v_announce_kind text;
  v_announce_message text;
  i integer;
begin
  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count, comet_box_count,
         lottery_ticket_count, vip_token_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_comet_box_count,
       v_lottery_ticket_count, v_vip_token_count, v_character_name, v_character_class, v_composition_stones, v_gems,
       v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if p_use_tickets then
    if coalesce(v_lottery_ticket_count, 0) < 8 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_lottery_tickets');
    end if;
  else
    select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
    if v_ap_balance < 160 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ap', 'cost', 160, 'ascension_points', v_ap_balance);
    end if;
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
      and not (id = any(v_equipped_ids));

    select coalesce(sum((value)::integer), 0) into v_stone_count
    from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

    select coalesce(sum((value)::integer), 0) into v_gem_count
    from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = p_character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count + v_comet_box_count + v_vip_token_count;

    if v_occupied + v_needed_room > 40 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_room');
    end if;
  end if;

  if p_use_tickets then
    v_lottery_ticket_count := v_lottery_ticket_count - 8;
  else
    update public.players set ascension_points = ascension_points - 160 where id = v_account_id
    returning ascension_points into v_new_ap;
  end if;

  for i in 0..8 loop
    v_entry := v_board -> i;
    v_kind := v_entry ->> 'kind';
    v_amount := (v_entry ->> 'amount')::integer;
    v_template_id := null;
    v_announce_kind := null;
    v_announce_message := null;

    if v_kind = 'comet' then
      v_comet_count := v_comet_count + 1;
    elsif v_kind = 'comet_box' then
      v_comet_box_count := v_comet_box_count + 1;
    elsif v_kind = 'vip_token' then
      v_vip_token_count := v_vip_token_count + 1;
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
      from public.item_templates where name = 'Moon Box';

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
      v_announce_kind := 'lucky_comet_box';
      v_announce_message := v_character_name || ' won a Comet Box from LL!';
    elsif v_kind = 'vip_token' then
      v_announce_kind := 'lucky_vip_token';
      v_announce_message := v_character_name || ' won a VIP Token from LL!';
    elsif v_kind = 'fallen_star_scroll' then
      v_announce_kind := 'lucky_fallen_star_scroll';
      v_announce_message := v_character_name || ' won a Fallen Star Scroll from LL!';
    elsif v_kind = 'fallen_star' then
      v_announce_kind := 'lucky_fallen_star';
      v_announce_message := v_character_name || ' won a Fallen Star from LL!';
    elsif v_kind = 'money_bag' and v_amount >= 6 then
      v_announce_kind := 'lucky_money_bag';
      v_announce_message := v_character_name || ' won a Class ' || v_amount || ' Money Bag from LL!';
    elsif v_kind = 'composition_stone' and v_amount >= 5 then
      v_announce_kind := 'lucky_stone';
      v_announce_message := v_character_name || ' won a +' || v_amount || ' Stone from LL!';
    elsif v_kind like 'gem\_ascended\_%' escape '\' then
      v_announce_kind := 'lucky_gem_ascended';
      v_announce_message := v_character_name || ' won an Ascended ' || initcap(v_gem_id) || ' Gem from LL!';
    elsif v_kind = 'gear_radiant_bow' then
      v_announce_kind := 'lucky_gear_radiant_bow';
      v_announce_message := v_character_name || ' won a Radiant Ranger''s Bow from LL!';
    elsif v_kind = 'gear_radiant_coat' then
      v_announce_kind := 'lucky_gear_radiant_coat';
      v_announce_message := v_character_name || ' won a Radiant Fawnhide Coat from LL!';
    elsif v_kind = 'gear_ascended_random' and v_template_id is not null then
      select name into v_item_name from public.item_templates where id = v_template_id;
      v_announce_kind := 'lucky_gear_ascended_random';
      v_announce_message := v_character_name || ' won an Ascended ' || coalesce(v_item_name, 'item') || ' from LL!';
    end if;

    if v_announce_message is not null then
      v_pending_announcements := v_pending_announcements || jsonb_build_array(
        jsonb_build_object('index', i, 'kind', v_announce_kind, 'character_name', v_character_name, 'message', v_announce_message)
      );
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
    vip_token_count = v_vip_token_count,
    lottery_ticket_count = v_lottery_ticket_count,
    composition_stones = v_composition_stones,
    gems = v_gems,
    lucky_bulk_pending_announcements = v_pending_announcements
  where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'board', v_board,
    'cost', case when p_use_tickets then 8 else 160 end,
    'payment', case when p_use_tickets then 'lottery_ticket' else 'ascension_points' end,
    'character', jsonb_build_object(
      'gold', v_gold,
      'comet_count', v_comet_count,
      'fallen_star_count', v_fallen_star_count,
      'comet_scroll_count', v_comet_scroll_count,
      'fallen_star_scroll_count', v_fallen_star_scroll_count,
      'comet_box_count', v_comet_box_count,
      'lottery_ticket_count', v_lottery_ticket_count,
      'vip_token_count', v_vip_token_count
    ),
    'ascension_points', v_new_ap,
    'granted_items', v_granted_items,
    'composition_stones', v_composition_stones,
    'gems', v_gems
  );
end;
$$;

commit;
