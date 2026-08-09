-- Split Lucky Lad's generic gem_tempered/gem_ascended rewards into 8
-- per-gem-type kinds (2026-08-13, requested by the user: "items like
-- Tempered Gem and Ascended Gem in Lucky Lad should display as individual
-- items — you should know which gem you've won when you roll for it").
--
-- Previously pick_lucky_reward only ever returned the generic {kind:
-- 'gem_tempered'|'gem_ascended', amount: 1} for these two weight rows, and
-- draw_lucky_ticket rolled a random gem type (drake/ember/bastion/iris)
-- itself, but only for whichever card the player actually picked (see the
-- old `v_gem_id := (array[...])[floor(random()*4)::int+1]` line) — every
-- OTHER card on the 9-card board of that kind stayed generic forever, since
-- the board is built by calling pick_lucky_reward 9 times up front and the
-- gem type was never part of what it returned. That's why the client showed
-- "Tempered Gem"/"Ascended Gem" instead of a real item.
--
-- Fix: bake the gem type directly into the reward kind
-- (gem_tempered_<id>/gem_ascended_<id>) and roll it as part of the same
-- weighted pick, so every board entry — won or not — is a real, specific
-- gem from the moment the board is generated. The original two weights
-- (gem_tempered 8.0, gem_ascended 3.0) are split evenly 4 ways across the
-- 4 coded gem types: 2.0 each for tempered, 0.75 each for ascended. Total
-- weight is unchanged (still sums to 100).
begin;

-- ============================================================================
-- 1. pick_lucky_reward — gem_tempered/gem_ascended rows split into 8.
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
      -- ===== Common (61.9) =====
      ('money_bag', 1, 16.3::numeric),
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
      -- ===== Rare (9.9) =====
      ('fallen_star', 1, 4.0::numeric),
      ('gem_ascended_drake', 1, 0.75::numeric),
      ('gem_ascended_ember', 1, 0.75::numeric),
      ('gem_ascended_bastion', 1, 0.75::numeric),
      ('gem_ascended_iris', 1, 0.75::numeric),
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

  -- Floating-point safety net only — weights above sum to exactly 100, this
  -- should never actually be reached.
  return jsonb_build_object('kind', 'comet', 'amount', 1);
end;
$$;

-- ============================================================================
-- 2. draw_lucky_ticket — the gem type/tier now comes straight out of v_kind
--    (e.g. 'gem_tempered_drake') instead of being rolled separately here.
--    Unchanged 3-arg signature, so plain create-or-replace is safe.
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
  v_new_item item_instances%rowtype;
  v_granted_item jsonb;
  v_item_name text;
  i integer;
begin
  if p_card_index is null or p_card_index < 0 or p_card_index > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_index');
  end if;

  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         lucky_free_ticket_claimed_at, lottery_ticket_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
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
    v_free_available := v_free_claimed_at is null or now() - v_free_claimed_at >= interval '6 hours';

    if v_free_available then
      v_payment := 'free';
    else
      v_payment := 'ascension_points';
      select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
      if v_ap_balance < 20 then
        v_next_free_at := v_free_claimed_at + interval '6 hours';
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
    'money_bag', 'gem_bag', 'composition_stone',
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
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

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

  if v_kind = 'comet' then
    v_new_comet_count := v_comet_count + 1;
  elsif v_kind = 'fallen_star' then
    v_new_fallen_star_count := v_fallen_star_count + 1;
  elsif v_kind = 'comet_scroll' then
    v_new_comet_scroll_count := v_comet_scroll_count + 1;
  elsif v_kind = 'fallen_star_scroll' then
    v_new_fallen_star_scroll_count := v_fallen_star_scroll_count + 1;
  elsif v_kind = 'money_bag' then
    select id into v_template_id
    from public.item_templates where name = 'Class ' || v_amount || ' Money Bag';

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets)
    values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb)
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gem_bag' then
    select id into v_template_id from public.item_templates where name = 'Random Gem Bag';

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets)
    values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb)
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'composition_stone' then
    v_stone_key := v_amount::text;
    v_stone_owned := coalesce((v_composition_stones ->> v_stone_key)::integer, 0);
    v_composition_stones := jsonb_set(coalesce(v_composition_stones, '{}'::jsonb), array[v_stone_key], to_jsonb(v_stone_owned + 1));
    update public.characters set composition_stones = v_composition_stones where id = p_character_id;
  elsif v_kind like 'gem\_tempered\_%' escape '\' or v_kind like 'gem\_ascended\_%' escape '\' then
    -- Gem type/tier are now baked into the kind itself, e.g.
    -- 'gem_tempered_drake' -> id 'drake', tier 'tempered' (see
    -- pick_lucky_reward and LuckyRewardKind's own header for why).
    v_gem_id := split_part(v_kind, '_', 3);
    v_gem_tier := split_part(v_kind, '_', 2);
    v_gem_key := v_gem_id || '_' || v_gem_tier;
    v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
    v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned + 1));
    update public.characters set gems = v_gems where id = p_character_id;
  elsif v_kind = 'gear_radiant_bow' then
    select id into v_template_id
    from public.item_templates where name = 'Ranger''s Bow' and required_level = 15;

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets)
    values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb)
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gear_radiant_coat' then
    select id into v_template_id
    from public.item_templates where name = 'Fawnhide Coat' and required_level = 15;

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets)
    values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb)
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gear_ascended_random' then
    v_template_id := public.pick_ascended_reward_template(v_character_class);

    if v_template_id is not null then
      select required_level into v_required_level from public.item_templates where id = v_template_id;

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets)
      values (v_template_id, p_character_id, 'ascended', v_required_level, '[]'::jsonb)
      returning * into v_new_item;
      v_granted_item := to_jsonb(v_new_item);
    end if;
  end if;

  -- Announcement scope (2026-08-10, confirmed with the user): anything at
  -- least as rare as Comet Scroll's own weight, minus Money Bags/Composition
  -- Stones (kept out deliberately — those already feel like a frequent
  -- progression drip, not a standout win). `kind` here stays the generic
  -- lucky_gem_tempered/lucky_gem_ascended discriminator (unchanged) — the
  -- specific gem name is already in the message text, which
  -- GlobalAnnouncementTicker.tsx's resolveAnnouncementIconSrc parses back
  -- out client-side for its icon.
  if v_kind = 'comet_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_comet_scroll', v_character_name, v_character_name || ' won a Comet Scroll from Lucky Lad!');
  elsif v_kind = 'fallen_star_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star_scroll', v_character_name, v_character_name || ' won a Fallen Star Scroll from Lucky Lad!');
  elsif v_kind = 'fallen_star' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star', v_character_name, v_character_name || ' won a Fallen Star from Lucky Lad!');
  elsif v_kind like 'gem\_tempered\_%' escape '\' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gem_tempered', v_character_name, v_character_name || ' won a Tempered ' || initcap(v_gem_id) || ' Gem from Lucky Lad!');
  elsif v_kind like 'gem\_ascended\_%' escape '\' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gem_ascended', v_character_name, v_character_name || ' won an Ascended ' || initcap(v_gem_id) || ' Gem from Lucky Lad!');
  elsif v_kind = 'gear_radiant_bow' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_radiant_bow', v_character_name, v_character_name || ' won a Radiant Ranger''s Bow from Lucky Lad!');
  elsif v_kind = 'gear_radiant_coat' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_radiant_coat', v_character_name, v_character_name || ' won a Radiant Fawnhide Coat from Lucky Lad!');
  elsif v_kind = 'gear_ascended_random' and v_granted_item is not null then
    select name into v_item_name from public.item_templates where id = v_template_id;
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_ascended_random', v_character_name, v_character_name || ' won an Ascended ' || coalesce(v_item_name, 'item') || ' from Lucky Lad!');
  end if;

  update public.characters
  set
    gold = v_new_gold,
    comet_count = v_new_comet_count,
    fallen_star_count = v_new_fallen_star_count,
    comet_scroll_count = v_new_comet_scroll_count,
    fallen_star_scroll_count = v_new_fallen_star_scroll_count
  where id = p_character_id;

  select lucky_free_ticket_claimed_at + interval '6 hours' into v_next_free_at
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

commit;
