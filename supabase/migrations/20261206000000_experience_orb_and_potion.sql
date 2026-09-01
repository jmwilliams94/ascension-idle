-- Experience Orb and Experience Potion — two new consumables, same virtual-
-- tile counter shape as VIP Token/Comet Box (characters.experience_orb_count/
-- experience_potion_count, one non-stacking Inventory tile per owned unit, no
-- item_templates/item_instances row). Not catalog items.
--
-- Experience Orb: instant EXP grant equal to a tier-stepped percentage of
-- requiredExpForLevel(character.level) — percentages [0.8, 0.5, 0.3, 0.16,
-- 0.08, 0.04, 0.02] at the same promotion-tier level breaks used for kill
-- pacing client-side (PROMOTION_TIER_ANCHORS in expCurve.ts: [1, 15, 40, 70,
-- 100, 110, 120]). requiredExpForLevel/PROMOTION_TIER_ANCHORS already exist
-- in 2 places (src/game/stats/expCurve.ts client, resolve-combat/index.ts
-- Deno) — this migration adds a 3rd plpgsql copy (required_exp_for_level/
-- experience_orb_percent_for_level below), a deliberate choice (confirmed
-- with the user) over a dedicated Edge Function, consistent with the
-- project's existing tolerance for this duplication. Must stay in sync
-- across all 3 files if the curve/tiers ever change.
--
-- Experience Potion: doubles EXP from kills for 1 hour, per-character
-- (characters.exp_potion_expires_at, stacks on remaining time like VIP's own
-- expiry — greatest(coalesce(existing, now()), now()) + 1 hour). Applied
-- server-side in resolve-combat's onKill (see that file's own change) — read
-- directly off the character row resolve_combat_gather_state already
-- serializes whole via to_jsonb(c), so no gather-RPC change needed.
--
-- Acquisition: Lucky Lad (both at weight 2.0, same rate as Class 6 Money
-- Bag) + Admin Mail. Class 1-4 Money Bags trimmed proportionally to absorb
-- the 4.0 added weight, Rare/Hyper Rare buckets left untouched (confirmed
-- with the user) — table still sums to exactly 100.
begin;

alter table public.characters add column experience_orb_count integer not null default 0;
alter table public.characters add constraint characters_experience_orb_count_check check (experience_orb_count >= 0);
alter table public.characters add column experience_potion_count integer not null default 0;
alter table public.characters add constraint characters_experience_potion_count_check check (experience_potion_count >= 0);
alter table public.characters add column exp_potion_expires_at timestamptz;

-- ============================================================================
-- 1. required_exp_for_level / experience_orb_percent_for_level — internal
--    helpers, no authenticated grant (only called by SECURITY DEFINER
--    use_experience_orb below — same "internal helper" precedent as
--    ensure_loose_currency).
-- ============================================================================
create or replace function public.required_exp_for_level(p_level integer)
returns bigint
language plpgsql
as $$
declare
  anchors integer[] := array[1, 20, 21, 80, 81, 109, 110, 127, 128, 130];
  anchor_values bigint[] := array[39, 68789, 70451, 15896985, 16163738, 193716061, 408832135, 1011439064, 1073741808, 1073741808];
  v_clamped integer := least(greatest(p_level, 1), 130);
  v_prev_level integer;
  v_prev_value bigint;
  v_anchor_level integer;
  v_anchor_value bigint;
  v_t double precision;
  i integer;
begin
  for i in 1..array_length(anchors, 1) loop
    v_anchor_level := anchors[i];
    v_anchor_value := anchor_values[i];

    if v_clamped = v_anchor_level then
      return v_anchor_value;
    end if;

    if v_clamped < v_anchor_level then
      v_prev_level := anchors[i - 1];
      v_prev_value := anchor_values[i - 1];
      v_t := (v_clamped - v_prev_level)::double precision / (v_anchor_level - v_prev_level);
      return round(v_prev_value * power(v_anchor_value::double precision / v_prev_value, v_t));
    end if;
  end loop;

  return anchor_values[array_length(anchor_values, 1)];
end;
$$;

create or replace function public.experience_orb_percent_for_level(p_level integer)
returns numeric
language plpgsql
as $$
declare
  tiers integer[] := array[1, 15, 40, 70, 100, 110, 120];
  percents numeric[] := array[0.8, 0.5, 0.3, 0.16, 0.08, 0.04, 0.02];
  v_idx integer := 1;
  i integer;
begin
  for i in 1..array_length(tiers, 1) loop
    if p_level >= tiers[i] then
      v_idx := i;
    end if;
  end loop;
  return percents[v_idx];
end;
$$;

-- ============================================================================
-- 2. use_experience_orb — consumes 1 Orb, grants EXP + runs the normal
--    level-up loop (mirrors requiredExpForLevel's client-side level-up
--    convention, capped at 130 with exp zeroed at cap same as addRewards).
-- ============================================================================
create or replace function public.use_experience_orb(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_level integer;
  v_exp bigint;
  v_orb_count integer;
  v_exp_gain bigint;
  v_new_exp bigint;
  v_new_level integer;
  v_required bigint;
  v_new_orb_count integer;
begin
  select account_id, level, exp, experience_orb_count
  into v_account_id, v_level, v_exp, v_orb_count
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if coalesce(v_orb_count, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_orbs');
  end if;

  if v_level >= 130 then
    return jsonb_build_object('ok', false, 'error', 'max_level');
  end if;

  v_exp_gain := round(public.required_exp_for_level(v_level) * public.experience_orb_percent_for_level(v_level));
  v_new_exp := v_exp + v_exp_gain;
  v_new_level := v_level;
  v_required := public.required_exp_for_level(v_new_level);

  while v_new_level < 130 and v_new_exp >= v_required loop
    v_new_exp := v_new_exp - v_required;
    v_new_level := v_new_level + 1;
    v_required := public.required_exp_for_level(v_new_level);
  end loop;

  if v_new_level >= 130 then
    v_new_exp := 0;
  end if;

  update public.characters
  set exp = v_new_exp, level = v_new_level, experience_orb_count = experience_orb_count - 1
  where id = p_character_id
  returning experience_orb_count into v_new_orb_count;

  return jsonb_build_object(
    'ok', true, 'exp_gained', v_exp_gain, 'exp', v_new_exp, 'level', v_new_level, 'experience_orb_count', v_new_orb_count
  );
end;
$$;

revoke all on function public.use_experience_orb(uuid) from public;
grant execute on function public.use_experience_orb(uuid) to authenticated;

-- ============================================================================
-- 3. use_experience_potion — consumes 1 Potion, adds a flat 1 hour to
--    exp_potion_expires_at, stacking on remaining time (same convention as
--    use_vip_token's vip_expires_at).
-- ============================================================================
create or replace function public.use_experience_potion(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_potion_count integer;
  v_expires_at timestamptz;
  v_new_expires_at timestamptz;
  v_new_potion_count integer;
begin
  select account_id, experience_potion_count, exp_potion_expires_at
  into v_account_id, v_potion_count, v_expires_at
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if coalesce(v_potion_count, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_potions');
  end if;

  v_new_expires_at := greatest(coalesce(v_expires_at, now()), now()) + interval '1 hour';

  update public.characters
  set experience_potion_count = experience_potion_count - 1,
      exp_potion_expires_at = v_new_expires_at
  where id = p_character_id
  returning experience_potion_count into v_new_potion_count;

  return jsonb_build_object('ok', true, 'experience_potion_count', v_new_potion_count, 'exp_potion_expires_at', v_new_expires_at);
end;
$$;

revoke all on function public.use_experience_potion(uuid) from public;
grant execute on function public.use_experience_potion(uuid) to authenticated;

-- ============================================================================
-- 4. pick_lucky_reward — Experience Orb + Experience Potion added at 2.0
--    each (Class 6 Money Bag's own rate), Class 1-4 Money Bags trimmed
--    proportionally to absorb the 4.0, Rare/Hyper Rare untouched. Table
--    still sums to exactly 100.
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
      -- ===== Common (58.69) =====
      ('money_bag', 1, 12.66::numeric),
      ('money_bag', 2, 10.71::numeric),
      ('comet', 1, 9.0::numeric),
      ('money_bag', 3, 6.25::numeric),
      ('composition_stone', 1, 5.5::numeric),
      ('gem_bag', 1, 5.5::numeric),
      ('money_bag', 4, 3.57::numeric),
      ('composition_stone', 2, 3.5::numeric),
      ('composition_stone', 3, 2.0::numeric),
      -- ===== Uncommon (32.0) =====
      ('comet_scroll', 1, 8.0::numeric),
      ('gem_tempered_drake', 1, 2.0::numeric),
      ('gem_tempered_ember', 1, 2.0::numeric),
      ('gem_tempered_bastion', 1, 2.0::numeric),
      ('gem_tempered_iris', 1, 2.0::numeric),
      ('money_bag', 5, 5.5::numeric),
      ('composition_stone', 4, 3.5::numeric),
      ('money_bag', 6, 2.0::numeric),
      ('experience_orb', 1, 2.0::numeric),
      ('experience_potion', 1, 2.0::numeric),
      ('money_bag', 7, 0.7::numeric),
      ('money_bag', 8, 0.3::numeric),
      -- ===== Rare (9.09) =====
      ('fallen_star', 1, 2.0::numeric),
      ('gem_ascended_drake', 1, 0.75::numeric),
      ('gem_ascended_ember', 1, 0.75::numeric),
      ('gem_ascended_bastion', 1, 0.75::numeric),
      ('gem_ascended_iris', 1, 0.75::numeric),
      ('composition_stone', 5, 1.5::numeric),
      ('composition_stone', 6, 0.6::numeric),
      ('comet_box', 100, 0.4::numeric),
      ('moon_box', 1, 0.5::numeric),
      ('fallen_star_scroll', 1, 0.4::numeric),
      ('composition_stone', 7, 0.2::numeric),
      ('money_bag', 9, 0.3::numeric),
      ('composition_stone', 8, 0.07::numeric),
      ('money_bag', 10, 0.1::numeric),
      ('composition_stone', 9, 0.02::numeric),
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
-- 5. draw_lucky_ticket — full-body copy from 20261030000000's version, adding
--    experience_orb_count/experience_potion_count plumbing (select/into,
--    occupied-count inclusion, grant branches, announcements, update,
--    response). Not in v_needs_room, same as vip_token/comet_box.
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
  v_experience_orb_count integer;
  v_experience_potion_count integer;
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
  v_new_experience_orb_count integer;
  v_new_experience_potion_count integer;
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
         lottery_ticket_count, vip_token_count, experience_orb_count, experience_potion_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_comet_box_count,
       v_lottery_ticket_count, v_vip_token_count, v_experience_orb_count, v_experience_potion_count, v_character_name, v_character_class,
       v_composition_stones, v_gems, v_equipped_ids
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
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count + v_comet_box_count + v_vip_token_count
      + v_experience_orb_count + v_experience_potion_count;

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
  v_new_experience_orb_count := v_experience_orb_count;
  v_new_experience_potion_count := v_experience_potion_count;

  if v_kind = 'comet' then
    v_new_comet_count := v_comet_count + 1;
  elsif v_kind = 'comet_box' then
    v_new_comet_box_count := v_comet_box_count + 1;
  elsif v_kind = 'vip_token' then
    v_new_vip_token_count := v_vip_token_count + 1;
  elsif v_kind = 'experience_orb' then
    v_new_experience_orb_count := v_experience_orb_count + 1;
  elsif v_kind = 'experience_potion' then
    v_new_experience_potion_count := v_experience_potion_count + 1;
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
  elsif v_kind = 'experience_orb' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_experience_orb', v_character_name, v_character_name || ' won an Experience Orb from LL!');
  elsif v_kind = 'experience_potion' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_experience_potion', v_character_name, v_character_name || ' won an Experience Potion from LL!');
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
    vip_token_count = v_new_vip_token_count,
    experience_orb_count = v_new_experience_orb_count,
    experience_potion_count = v_new_experience_potion_count
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
      'vip_token_count', v_new_vip_token_count,
      'experience_orb_count', v_new_experience_orb_count,
      'experience_potion_count', v_new_experience_potion_count
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
-- 6. draw_lucky_ticket_bulk — same treatment, full-body copy from
--    20261030000000's version.
-- ============================================================================
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
  v_experience_orb_count integer;
  v_experience_potion_count integer;
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
         lottery_ticket_count, vip_token_count, experience_orb_count, experience_potion_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_comet_box_count,
       v_lottery_ticket_count, v_vip_token_count, v_experience_orb_count, v_experience_potion_count, v_character_name, v_character_class,
       v_composition_stones, v_gems, v_equipped_ids
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
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count + v_comet_box_count + v_vip_token_count
      + v_experience_orb_count + v_experience_potion_count;

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
    elsif v_kind = 'experience_orb' then
      v_experience_orb_count := v_experience_orb_count + 1;
    elsif v_kind = 'experience_potion' then
      v_experience_potion_count := v_experience_potion_count + 1;
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
    elsif v_kind = 'experience_orb' then
      v_announce_kind := 'lucky_experience_orb';
      v_announce_message := v_character_name || ' won an Experience Orb from LL!';
    elsif v_kind = 'experience_potion' then
      v_announce_kind := 'lucky_experience_potion';
      v_announce_message := v_character_name || ' won an Experience Potion from LL!';
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
    experience_orb_count = v_experience_orb_count,
    experience_potion_count = v_experience_potion_count,
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
      'vip_token_count', v_vip_token_count,
      'experience_orb_count', v_experience_orb_count,
      'experience_potion_count', v_experience_potion_count
    ),
    'ascension_points', v_new_ap,
    'granted_items', v_granted_items,
    'composition_stones', v_composition_stones,
    'gems', v_gems
  );
end;
$$;

-- ============================================================================
-- 7. Mail — experience_orb/experience_potion become new Mail currency_types
--    (Admin Mail grants). Full-body copy of claim_mail from
--    20260930120000_vip_token.sql, only the two new branches added.
-- ============================================================================
alter table public.mail drop constraint if exists mail_currency_type_check;
alter table public.mail add constraint mail_currency_type_check
  check (currency_type in (
    'comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll', 'lottery_ticket', 'ascension_points', 'gold',
    'comet_box', 'vip_token', 'experience_orb', 'experience_potion'
  ));

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
    elsif v_currency_type = 'experience_orb' then
      update public.characters set experience_orb_count = experience_orb_count + v_amount where id = p_character_id
      returning experience_orb_count into v_new_count;
    elsif v_currency_type = 'experience_potion' then
      update public.characters set experience_potion_count = experience_potion_count + v_amount where id = p_character_id
      returning experience_potion_count into v_new_count;
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

commit;
