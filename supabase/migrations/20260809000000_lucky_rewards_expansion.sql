-- Lucky Lad rewards expansion (2026-08-09) — replaces the flat gold reward
-- with tiered Money Bag items (Class 1-10, opened for gold), and adds five
-- reward categories that had no drop source anywhere in the game before
-- this: Composition Stones, Gems (Tempered/Ascended granted directly, or
-- Normal via a Random Gem Bag), and two rarity bands of pre-made gear (a
-- hyper-rare Radiant 2-socket Bow/Coat, and a broader Ascended pool).
--
-- Confirmed with the user: gold ramp is round numbers 1k-10M across 10
-- classes; gems are limited to the 4 already-coded types (Drake/Ember/
-- Bastion/Iris — Rage/Orchid/Kirin/Crescent stay code-less for now); Money
-- Bags/Gem Bags are real item_templates/item_instances rows, not a
-- stackable jsonb counter.
--
-- Weight table sums to exactly 100 — see pick_lucky_reward below.
begin;

-- ============================================================================
-- 1. Seed the 11 new item_templates rows (10 Money Bag classes + Random Gem
--    Bag). slot_type/item_family are free-text, non-equippable values — same
--    precedent as the Hunter's Quiver (slot_type: 'quiver').
--    item_templates.price is reused to hold each Money Bag's gold payout
--    (never Shop-listed, so no collision with its normal buy-price meaning).
-- ============================================================================
insert into public.item_templates (name, slot_type, item_family, required_class, required_level, base_stats, price)
select v.name, 'money-bag', 'money-bag', null, 1, '{}'::jsonb, v.price
from (values
  ('Class 1 Money Bag', 1000),
  ('Class 2 Money Bag', 2500),
  ('Class 3 Money Bag', 5000),
  ('Class 4 Money Bag', 10000),
  ('Class 5 Money Bag', 25000),
  ('Class 6 Money Bag', 50000),
  ('Class 7 Money Bag', 100000),
  ('Class 8 Money Bag', 500000),
  ('Class 9 Money Bag', 2000000),
  ('Class 10 Money Bag', 10000000)
) as v(name, price)
where not exists (select 1 from public.item_templates where name = v.name);

insert into public.item_templates (name, slot_type, item_family, required_class, required_level, base_stats, price)
select 'Random Gem Bag', 'gem-bag', 'gem-bag', null, 1, '{}'::jsonb, 0
where not exists (select 1 from public.item_templates where name = 'Random Gem Bag');

-- ============================================================================
-- 2. pick_lucky_reward — full replacement of the old flat-gold weight table.
--    Same function signature (create or replace is safe, no drop needed).
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
      -- Money Bag classes 1-10 (amount = class number, not gold — the
      -- template's own `price` column holds the actual gold value).
      ('money_bag', 1, 26::numeric),
      ('money_bag', 2, 16::numeric),
      ('money_bag', 3, 10::numeric),
      ('money_bag', 4, 7::numeric),
      ('money_bag', 5, 5::numeric),
      ('money_bag', 6, 3.5::numeric),
      ('money_bag', 7, 1.8::numeric),
      ('money_bag', 8, 0.5::numeric),
      ('money_bag', 9, 0.15::numeric),
      ('money_bag', 10, 0.05::numeric),
      -- Unchanged from before this migration.
      ('comet', 1, 1.5::numeric),
      ('fallen_star', 1, 0.7::numeric),
      ('comet_scroll', 1, 0.25::numeric),
      ('fallen_star_scroll', 1, 0.05::numeric),
      -- New: Gem Bag (opens for 1 Normal gem, random of the 4 coded types).
      ('gem_bag', 1, 7.5::numeric),
      -- New: Composition Stone, amount = tier (1-6), credited directly (no bag).
      ('composition_stone', 1, 10.0::numeric),
      ('composition_stone', 2, 6.0::numeric),
      ('composition_stone', 3, 2.5::numeric),
      ('composition_stone', 4, 0.7::numeric),
      ('composition_stone', 5, 0.2::numeric),
      ('composition_stone', 6, 0.05::numeric),
      -- New: Gems granted directly (no bag) — random of the 4 coded types.
      ('gem_tempered', 1, 0.4::numeric),
      ('gem_ascended', 1, 0.04::numeric),
      -- New: hyper-rare pre-made gear.
      ('gear_radiant_bow', 1, 0.005::numeric),
      ('gear_radiant_coat', 1, 0.005::numeric),
      ('gear_ascended_random', 1, 0.1::numeric)
    ) as t(kind, amount, weight)
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return jsonb_build_object('kind', v_row.kind, 'amount', v_row.amount);
    end if;
  end loop;

  -- Floating-point safety net only — weights above sum to exactly 100, this
  -- should never actually be reached.
  return jsonb_build_object('kind', 'money_bag', 'amount', 1);
end;
$$;

-- ============================================================================
-- 3. pick_ascended_reward_template — mirrors pick_infused_reward_template's
--    shape (random class-appropriate family, then a template within it) but
--    filtered to required_level 15-70, for the "handful of Ascended gear"
--    reward.
-- ============================================================================
create or replace function public.pick_ascended_reward_template(p_character_class text)
returns uuid
language plpgsql
as $$
declare
  v_family text;
  v_template_id uuid;
begin
  select item_family into v_family
  from public.item_templates
  where (required_class is null or required_class = p_character_class)
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag')
    and required_level between 15 and 70
  group by item_family
  order by random()
  limit 1;

  if v_family is null then
    return null;
  end if;

  select id into v_template_id
  from public.item_templates
  where item_family = v_family
    and required_level between 15 and 70
  order by random()
  limit 1;

  return v_template_id;
end;
$$;

-- ============================================================================
-- 4. pick_infused_reward_template — add the two new non-gear families to the
--    exclusion list so an Achievements tier-6 claim can never roll a bag.
-- ============================================================================
create or replace function public.pick_infused_reward_template(p_character_class text, p_monster_level integer)
returns uuid language plpgsql as $$
declare v_family text; v_template_id uuid;
begin
  select item_family into v_family from public.item_templates
  where (required_class is null or required_class = p_character_class)
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag')
  group by item_family order by random() limit 1;
  if v_family is null then return null; end if;
  select id into v_template_id from public.item_templates
  where item_family = v_family
  order by abs(required_level - p_monster_level) asc limit 1;
  return v_template_id;
end; $$;

-- ============================================================================
-- 5. draw_lucky_ticket — same 3-arg signature (create or replace is safe).
--    New: a room-check gate before payment is deducted for any kind that
--    grants something occupying an Inventory slot; new kind branches for
--    money_bag/gem_bag/composition_stone/gem_tempered/gem_ascended/
--    gear_radiant_bow/gear_radiant_coat/gear_ascended_random; response now
--    also carries granted_item/composition_stones/gems so the client can
--    reflect the grant without a full reload.
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
  v_potion_count integer;
  v_occupied integer;
  v_needs_room boolean;
  v_stone_key text;
  v_stone_owned integer;
  v_gem_id text;
  v_gem_key text;
  v_gem_owned integer;
  v_template_id uuid;
  v_required_level integer;
  v_new_item item_instances%rowtype;
  v_granted_item jsonb;
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
      -- Same players-then-characters lock ordering as sell_item/
      -- create_marketplace_listing (characters already locked above) — avoids
      -- deadlocking against a concurrent call touching both rows the other way.
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

  -- Roll the whole board now that eligibility is confirmed. Still nothing to
  -- read from outside this function — it's a local variable inside a single
  -- request that hasn't returned yet.
  for i in 0..8 loop
    v_board := v_board || jsonb_build_array(public.pick_lucky_reward());
  end loop;

  v_won := v_board -> p_card_index;
  v_kind := v_won ->> 'kind';
  v_amount := (v_won ->> 'amount')::integer;

  -- Room-check gate: refuse the WHOLE draw before any payment is deducted if
  -- the won kind would grant something that needs an Inventory slot and none
  -- is free — same "no partial completion" pattern as
  -- ensure_loose_currency's own room check. Gems are deliberately excluded
  -- (fungible characters.gems jsonb counter, no Inventory tile, same
  -- slot-free treatment as Comets/gold).
  v_needs_room := v_kind in ('money_bag', 'gem_bag', 'composition_stone', 'gear_radiant_bow', 'gear_radiant_coat', 'gear_ascended_random');

  if v_needs_room then
    select count(*) into v_gear_count
    from public.item_instances
    where owner_id = p_character_id
      and location <> 'bank'
      and not (id = any(v_equipped_ids));

    select coalesce(sum((value)::integer), 0) into v_stone_count
    from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = p_character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_potion_count
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
  elsif v_kind in ('gem_tempered', 'gem_ascended') then
    v_gem_id := (array['drake', 'ember', 'bastion', 'iris'])[floor(random() * 4)::int + 1];
    v_gem_key := v_gem_id || case when v_kind = 'gem_tempered' then '_tempered' else '_ascended' end;
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

  if v_kind = 'comet_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_comet_scroll', v_character_name, v_character_name || ' won a Comet Scroll from Lucky Lad!');
  elsif v_kind = 'fallen_star_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star_scroll', v_character_name, v_character_name || ' won a Fallen Star Scroll from Lucky Lad!');
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

-- ============================================================================
-- 6. open_reward_item — new. Consumes a Money Bag/Gem Bag item_instances row
--    and grants its wrapped reward. Same ownership-lock/delete-on-consume
--    shape as sell_item.
-- ============================================================================
create or replace function public.open_reward_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_item_family text;
  v_price integer;
  v_new_gold integer;
  v_gem_id text;
  v_gem_key text;
  v_gems jsonb;
  v_gem_owned integer;
  v_granted jsonb;
begin
  select owner_id, template_id into v_character_id, v_template_id
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select item_family, price into v_item_family, v_price from public.item_templates where id = v_template_id;

  if v_item_family = 'money-bag' then
    update public.characters set gold = gold + v_price where id = v_character_id
    returning gold into v_new_gold;
    v_granted := jsonb_build_object('kind', 'gold', 'amount', v_price);
  elsif v_item_family = 'gem-bag' then
    select gems into v_gems from public.characters where id = v_character_id;
    v_gem_id := (array['drake', 'ember', 'bastion', 'iris'])[floor(random() * 4)::int + 1];
    v_gem_key := v_gem_id || '_normal';
    v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
    v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned + 1));
    update public.characters set gems = v_gems where id = v_character_id;
    v_granted := jsonb_build_object('kind', 'gem', 'gem_id', v_gem_id, 'tier', 'normal');
  else
    return jsonb_build_object('ok', false, 'error', 'not_openable');
  end if;

  delete from public.item_instances where id = item_id;

  return jsonb_build_object('ok', true, 'granted', v_granted, 'gold', v_new_gold, 'gems', v_gems);
end;
$$;

revoke all on function public.open_reward_item(uuid) from public;
grant execute on function public.open_reward_item(uuid) to authenticated;

commit;
