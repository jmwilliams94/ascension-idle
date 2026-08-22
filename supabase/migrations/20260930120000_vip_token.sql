-- VIP Token (groundwork only, requested by the user) — a consumable that
-- grants VIP status to the character that consumes it. VIP itself carries no
-- gameplay bonuses yet (deferred to a later pass) — this migration only lays
-- the plumbing: the item, its acquisition path, and the expiry clock.
--
-- Same virtual-tile counter shape as Comet Box (characters.vip_token_count,
-- one non-stacking Inventory tile per owned token, no item_instances row) —
-- not in draw_lucky_ticket's v_needs_room list either, matching Comet Box's
-- own precedent (a counter grant is never room-gated, only real
-- item_instances-backed grants are).
--
-- Acquisition: Lucky Lad only for now (rarer than the rarest existing
-- reward — weight 0.02, below gear_radiant_bow/gear_radiant_coat's 0.06),
-- funded by trimming Class 1 Money Bag 11.8 -> 11.78 so the table still sums
-- to exactly 100. Also addable via Admin Mail for manual grants.
--
-- Using a token adds a flat 30 days to characters.vip_expires_at (null =
-- never been VIP), stacking on top of remaining time rather than replacing
-- it — greatest(coalesce(vip_expires_at, now()), now()) + 30 days, so a
-- token used while already VIP extends from the current expiry, and one used
-- after VIP lapsed starts fresh from now.
begin;

alter table public.characters add column vip_token_count integer not null default 0;
alter table public.characters add constraint characters_vip_token_count_check check (vip_token_count >= 0);
alter table public.characters add column vip_expires_at timestamptz;

-- ============================================================================
-- 1. pick_lucky_reward — add vip_token to the Hyper Rare bucket, funded by
--    trimming Class 1 Money Bag. Full body copy of 20260901030000's version.
-- ============================================================================
create or replace function public.pick_lucky_reward()
returns jsonb
language plpgsql
as $$
declare
  v_roll numeric := random() * 100;
  v_cumulative numeric := 0;
  v_row record;
begin
  for v_row in
    select * from (values
      -- ===== Common (57.38) =====
      ('money_bag', 1, 11.78::numeric),
      ('money_bag', 2, 12.0::numeric),
      ('comet', 1, 9.0::numeric),
      ('money_bag', 3, 7.0::numeric),
      ('composition_stone', 1, 5.5::numeric),
      ('money_bag', 4, 4.0::numeric),
      ('composition_stone', 2, 3.5::numeric),
      ('gem_bag', 1, 2.6::numeric),
      ('composition_stone', 3, 2.0::numeric),
      -- ===== Uncommon (28.0) =====
      ('comet_scroll', 1, 8.0::numeric),
      ('gem_tempered_drake', 1, 2.0::numeric),
      ('gem_tempered_ember', 1, 2.0::numeric),
      ('gem_tempered_bastion', 1, 2.0::numeric),
      ('gem_tempered_iris', 1, 2.0::numeric),
      ('money_bag', 5, 5.5::numeric),
      ('composition_stone', 4, 3.5::numeric),
      ('money_bag', 6, 2.0::numeric),
      ('money_bag', 7, 0.7::numeric),
      ('money_bag', 8, 0.3::numeric),
      -- ===== Rare (14.4) =====
      ('fallen_star', 1, 4.0::numeric),
      ('gem_ascended_drake', 1, 0.75::numeric),
      ('gem_ascended_ember', 1, 0.75::numeric),
      ('gem_ascended_bastion', 1, 0.75::numeric),
      ('gem_ascended_iris', 1, 0.75::numeric),
      ('comet_box', 100, 4.0::numeric),
      ('moon_box', 1, 0.5::numeric),
      ('fallen_star_scroll', 1, 0.4::numeric),
      ('composition_stone', 5, 1.5::numeric),
      ('composition_stone', 6, 0.6::numeric),
      ('money_bag', 9, 0.3::numeric),
      ('money_bag', 10, 0.1::numeric),
      -- ===== Hyper Rare (0.22) =====
      ('gear_ascended_random', 1, 0.08::numeric),
      ('gear_radiant_bow', 1, 0.06::numeric),
      ('gear_radiant_coat', 1, 0.06::numeric),
      ('vip_token', 1, 0.02::numeric)
    ) as t(kind, amount, weight)
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return jsonb_build_object('kind', v_row.kind, 'amount', v_row.amount);
    end if;
  end loop;
  return jsonb_build_object('kind', 'comet', 'amount', 1);
end;
$$;

-- ============================================================================
-- 2. draw_lucky_ticket — full-body copy of 20260901030000's version, adding
--    vip_token_count plumbing (select/into, occupied-count inclusion, grant
--    branch, announcement, update, response). Not in v_needs_room, same as
--    comet_box. Same 3-arg signature — create or replace is safe.
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
         lucky_free_ticket_claimed_at, lottery_ticket_count, vip_token_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_comet_box_count,
       v_free_claimed_at, v_lottery_ticket_count, v_vip_token_count, v_character_name, v_character_class, v_composition_stones, v_gems,
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
    update public.characters set lucky_free_ticket_claimed_at = now() where id = p_character_id;
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
  elsif v_kind = 'moon_box' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_moon_box', v_character_name, v_character_name || ' won a Moon Box from LL!');
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
    comet_box_count = v_new_comet_box_count,
    vip_token_count = v_new_vip_token_count
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

revoke all on function public.draw_lucky_ticket(uuid, integer, boolean) from public;
grant execute on function public.draw_lucky_ticket(uuid, integer, boolean) to authenticated;

-- ============================================================================
-- 3. draw_lucky_ticket_bulk — same treatment, full-body copy of
--    20260901030000's version with vip_token_count added.
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
  i integer;
begin
  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count, comet_box_count,
         lottery_ticket_count, vip_token_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
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
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_comet_box', v_character_name, v_character_name || ' won a Comet Box from LL!');
    elsif v_kind = 'vip_token' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_vip_token', v_character_name, v_character_name || ' won a VIP Token from LL!');
    elsif v_kind = 'moon_box' then
      insert into public.global_announcements (kind, character_name, message)
      values ('lucky_moon_box', v_character_name, v_character_name || ' won a Moon Box from LL!');
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
    vip_token_count = v_vip_token_count,
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

revoke all on function public.draw_lucky_ticket_bulk(uuid) from public;
grant execute on function public.draw_lucky_ticket_bulk(uuid) to authenticated;

-- ============================================================================
-- 4. use_vip_token — consumes 1 VIP Token, adds a flat 30 days to
--    vip_expires_at (stacking on top of remaining time, not replacing it).
-- ============================================================================
create or replace function public.use_vip_token(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_vip_token_count integer;
  v_vip_expires_at timestamptz;
  v_new_expires_at timestamptz;
begin
  select account_id, vip_token_count, vip_expires_at
  into v_account_id, v_vip_token_count, v_vip_expires_at
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if coalesce(v_vip_token_count, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_tokens');
  end if;

  v_new_expires_at := greatest(coalesce(v_vip_expires_at, now()), now()) + interval '30 days';

  update public.characters
  set vip_token_count = vip_token_count - 1,
      vip_expires_at = v_new_expires_at
  where id = p_character_id
  returning vip_token_count into v_vip_token_count;

  return jsonb_build_object('ok', true, 'vip_token_count', v_vip_token_count, 'vip_expires_at', v_new_expires_at);
end;
$$;

revoke all on function public.use_vip_token(uuid) from public;
grant execute on function public.use_vip_token(uuid) to authenticated;

-- ============================================================================
-- 5. Mail — vip_token becomes a new Mail currency_type (Admin Mail grants).
--    Full-body copy of claim_mail from 20260904000000, only the new branch
--    added.
-- ============================================================================
alter table public.mail drop constraint if exists mail_currency_type_check;
alter table public.mail add constraint mail_currency_type_check
  check (currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll', 'lottery_ticket', 'ascension_points', 'gold', 'comet_box', 'vip_token'));

create or replace function public.claim_mail(p_character_id uuid, p_mail_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_mail_character_id uuid;
  v_item_id uuid;
  v_currency_type text;
  v_amount integer;
  v_claimed_at timestamptz;
  v_new_count integer;
  v_new_claimed_at timestamptz;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id, currency_type, amount, claimed_at
  into v_mail_character_id, v_item_id, v_currency_type, v_amount, v_claimed_at
  from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  if v_claimed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  v_amount := coalesce(v_amount, 1);

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + v_amount where id = p_character_id returning comet_count into v_new_count;
    elsif v_currency_type = 'fallen_star' then
      update public.characters set fallen_star_count = fallen_star_count + v_amount where id = p_character_id returning fallen_star_count into v_new_count;
    elsif v_currency_type = 'comet_scroll' then
      update public.characters set comet_scroll_count = comet_scroll_count + v_amount where id = p_character_id
      returning comet_scroll_count into v_new_count;
    elsif v_currency_type = 'fallen_star_scroll' then
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count + v_amount where id = p_character_id
      returning fallen_star_scroll_count into v_new_count;
    elsif v_currency_type = 'comet_box' then
      update public.characters set comet_box_count = comet_box_count + v_amount where id = p_character_id
      returning comet_box_count into v_new_count;
    elsif v_currency_type = 'vip_token' then
      update public.characters set vip_token_count = vip_token_count + v_amount where id = p_character_id
      returning vip_token_count into v_new_count;
    elsif v_currency_type = 'lottery_ticket' then
      update public.characters set lottery_ticket_count = lottery_ticket_count + v_amount where id = p_character_id
      returning lottery_ticket_count into v_new_count;
    elsif v_currency_type = 'gold' then
      update public.characters set gold = gold + v_amount where id = p_character_id returning gold into v_new_count;
    else -- 'ascension_points' -- account-wide, not a characters column
      update public.players set ascension_points = ascension_points + v_amount where id = v_account_id
      returning ascension_points into v_new_count;
    end if;

    update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

    return jsonb_build_object(
      'ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count, 'claimed_at', v_new_claimed_at
    );
  end if;

  update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

  return jsonb_build_object('ok', true, 'item_id', v_item_id, 'claimed_at', v_new_claimed_at);
end;
$$;

-- ============================================================================
-- 6. Global Chat — snapshot is_vip onto each message at send time (same
--    "snapshot at write, don't join live" convention as seller_character_name
--    on marketplace listings) so ChatOverlay can show a VIP badge next to a
--    sender's name without a live per-message lookup into another account's
--    row (chat_messages has no RLS path to that today).
-- ============================================================================
alter table public.chat_messages add column is_vip boolean not null default false;

create or replace function public.send_chat_message(p_character_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_vip_expires_at timestamptz;
  v_trimmed text;
  v_last_sent_at timestamptz;
  v_id uuid;
  v_created_at timestamptz;
begin
  v_trimmed := trim(p_message);

  if v_trimmed = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_message');
  end if;

  if char_length(v_trimmed) > 280 then
    return jsonb_build_object('ok', false, 'error', 'message_too_long');
  end if;

  select account_id, name, vip_expires_at into v_account_id, v_character_name, v_vip_expires_at
  from public.characters
  where id = p_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select max(created_at) into v_last_sent_at
  from public.chat_messages
  where account_id = v_account_id;

  if v_last_sent_at is not null and now() - v_last_sent_at < interval '1 second' then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.chat_messages (account_id, character_name, message, is_vip)
  values (v_account_id, v_character_name, v_trimmed, v_vip_expires_at is not null and v_vip_expires_at > now())
  returning id, created_at into v_id, v_created_at;

  return jsonb_build_object('ok', true, 'id', v_id, 'created_at', v_created_at);
end;
$$;

commit;
