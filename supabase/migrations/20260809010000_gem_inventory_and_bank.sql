-- Gems become real, physical Inventory tiles + Bank items (2026-08-09,
-- follow-up to 20260809000000_lucky_rewards_expansion.sql) — confirmed with
-- the user: gems should occupy an Inventory slot like Comets/Fallen
-- Stars/Stones do, and be Bankable the same way (a symmetric per-unit
-- transfer between a character's wallet and an account-wide bank balance,
-- not a points-conversion like Composition Stones — gems have no "points"
-- concept, so this mirrors transfer_currency's model, not transfer_stone's).
--
-- This reverses the previous migration's "gems are slot-free like Comets/
-- gold" call — draw_lucky_ticket's room-check gate is extended below to
-- cover the two direct-grant gem kinds too. open_reward_item's Gem Bag
-- branch does NOT need a room check: opening a bag deletes a 1-slot item and
-- adds exactly 1 gem unit (also 1 slot) in its place, a net-zero swap that's
-- always safe regardless of current occupancy.
begin;

alter table public.players
  add column if not exists gems_banked jsonb not null default '{}'::jsonb;

-- ============================================================================
-- 1. transfer_gem — symmetric per-unit deposit/withdraw between a
--    character's `gems` and the account's `gems_banked`, mirroring
--    transfer_currency's shape (no Scroll-bundling — gems have no Scroll
--    concept, so this is simpler than that function).
-- ============================================================================
create or replace function public.transfer_gem(character_id uuid, gem_id text, tier text, amount integer, direction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_key text;
  v_gems jsonb;
  v_gems_banked jsonb;
  v_character_balance integer;
  v_bank_balance integer;
  v_equipped_ids uuid[];
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_occupied integer;
begin
  if gem_id not in ('drake', 'ember', 'bastion', 'iris') then
    return jsonb_build_object('ok', false, 'error', 'invalid_gem');
  end if;

  if tier not in ('normal', 'tempered', 'ascended') then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;

  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_key := gem_id || '_' || tier;

  select account_id, gems, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_gems, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_equipped_ids
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select gems_banked into v_gems_banked from public.players where id = v_account_id for update;

  v_character_balance := coalesce((v_gems ->> v_key)::integer, 0);
  v_bank_balance := coalesce((v_gems_banked ->> v_key)::integer, 0);

  if direction = 'deposit' then
    if v_character_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_character_balance := v_character_balance - amount;
    v_bank_balance := v_bank_balance + amount;
  else
    if v_bank_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;

    -- Room check — a withdrawn gem becomes its own non-stacking Inventory
    -- tile, same "exclude bank/equipped" accounting as every other room
    -- check in this file (see CLAUDE.md's recurring gotcha note).
    select count(*) into v_gear_count
    from public.item_instances
    where owner_id = character_id
      and location <> 'bank'
      and not (id = any(v_equipped_ids));

    select coalesce(sum((value)::integer), 0) into v_stone_count
    from public.characters, jsonb_each_text(composition_stones)
    where id = character_id;

    select coalesce(sum((value)::integer), 0) into v_gem_count
    from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = transfer_gem.character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

    if v_occupied + amount > 40 then
      return jsonb_build_object(
        'ok', false, 'error', 'not_enough_room',
        'occupied', v_occupied,
        'max_withdrawable', greatest(0, 40 - v_occupied)
      );
    end if;

    v_bank_balance := v_bank_balance - amount;
    v_character_balance := v_character_balance + amount;
  end if;

  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_key], to_jsonb(v_character_balance));
  v_gems_banked := jsonb_set(coalesce(v_gems_banked, '{}'::jsonb), array[v_key], to_jsonb(v_bank_balance));

  update public.characters set gems = v_gems where id = character_id;
  update public.players set gems_banked = v_gems_banked where id = v_account_id;

  return jsonb_build_object('ok', true, 'gems', v_gems, 'gems_banked', v_gems_banked);
end;
$$;

revoke all on function public.transfer_gem(uuid, text, text, integer, text) from public;
grant execute on function public.transfer_gem(uuid, text, text, integer, text) to authenticated;

-- ============================================================================
-- 2. draw_lucky_ticket — same 3-arg signature (create or replace is safe).
--    Only change from the previous migration: gem_tempered/gem_ascended now
--    also gate on room (they didn't need to when gems were slot-free), and
--    the occupied-slot formula now includes the character's own existing
--    gem count.
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
  -- ensure_loose_currency's own room check. gem_tempered/gem_ascended are
  -- included now that gems occupy a real Inventory slot (2026-08-09) — a
  -- Gem Bag's own contained gem does NOT need this check, since opening one
  -- is a net-zero slot swap (see open_reward_item).
  v_needs_room := v_kind in (
    'money_bag', 'gem_bag', 'composition_stone', 'gem_tempered', 'gem_ascended',
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

commit;
