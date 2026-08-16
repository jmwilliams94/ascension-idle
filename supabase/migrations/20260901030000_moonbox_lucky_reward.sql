-- Moon Box (2026-09-01, requested by the user) — a real Lucky Lad reward for
-- now; the item_templates row and its "Class Promotion tier 110 cost" role
-- both already exist (re-added by 20260901020000_promotion_item_adjustments.sql).
-- Not class-restricted like a promotion item — Lucky Lad's board isn't
-- scoped by class, same as Money Bag/Gem Bag.
--
-- Weight (PLACEHOLDER, like every other unresolved economy number in this
-- codebase): placed in the Rare bucket at 0.5, funded by trimming Class 1
-- Money Bag's own weight down by the same 0.5 (12.3 -> 11.8) — same "fund a
-- new/reweighted rare off the single largest weight" convention the Comet
-- Box migration originally established. Total stays exactly 100.0.
begin;

update public.item_templates set required_class = null where name = 'Moon Box';

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
      -- ===== Common (57.4) =====
      ('money_bag', 1, 11.8::numeric),
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
      -- ===== Hyper Rare (0.2) =====
      ('gear_ascended_random', 1, 0.08::numeric),
      ('gear_radiant_bow', 1, 0.06::numeric),
      ('gear_radiant_coat', 1, 0.06::numeric)
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

-- draw_lucky_ticket: full-body copy of 20260825000000's version, adding the
-- moon_box branch to v_needs_room, the grant elsif (mints 1 item_instances
-- row, same shape as money_bag/gem_bag), and an announcement. Same 3-arg
-- signature — create or replace is safe.
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
      and not (id = any(v_equipped_ids));

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

revoke all on function public.draw_lucky_ticket(uuid, integer, boolean) from public;
grant execute on function public.draw_lucky_ticket(uuid, integer, boolean) to authenticated;

-- draw_lucky_ticket_bulk: same treatment, full-body copy of 20260825000000's
-- version with the moon_box branch added.
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
      and not (id = any(v_equipped_ids));

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

revoke all on function public.draw_lucky_ticket_bulk(uuid) from public;
grant execute on function public.draw_lucky_ticket_bulk(uuid) to authenticated;

commit;
