-- Lucky Lad bulk-draw announcements now fire when the player actually flips
-- a card open, not the instant draw_lucky_ticket_bulk resolves all 9 cards
-- server-side (reported by the user: an "8 for 9" gear win announced to
-- global chat before any card had been turned over). The single-card draw
-- (draw_lucky_ticket) is unaffected -- its board flips open immediately after
-- the draw resolves anyway (LuckyPanel.tsx's own reveal animation, no
-- separate tap-to-reveal step), so its announcement timing already matches
-- the reveal.
--
-- draw_lucky_ticket_bulk no longer inserts into global_announcements
-- directly. Instead it stashes each qualifying card's announcement (kind,
-- character_name, message) into a new characters.lucky_bulk_pending_
-- announcements jsonb column, keyed by card index. The new
-- reveal_lucky_bulk_card RPC -- called by the client the instant a bulk-draw
-- card is tapped open (LuckyPanel's handleRevealBulkCard) -- looks up that
-- index, inserts the real announcement if one is pending, and removes it
-- from the column. Deliberately not trusting the client to supply the
-- announcement text itself: the client already knows every card's reward
-- (drawBulk returns the full board), but a client-supplied message could be
-- forged to broadcast fake wins to every player's global feed.
begin;

alter table public.characters
  add column if not exists lucky_bulk_pending_announcements jsonb not null default '[]'::jsonb;

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

    -- Same qualifying-kind conditions as before (see
    -- 20261005000000_lucky_announcements_weight_threshold.sql) -- only the
    -- destination changed, from an immediate global_announcements insert to
    -- a pending entry consumed later by reveal_lucky_bulk_card.
    if v_kind = 'comet_box' then
      v_announce_kind := 'lucky_comet_box';
      v_announce_message := v_character_name || ' won a Comet Box from LL!';
    elsif v_kind = 'vip_token' then
      v_announce_kind := 'lucky_vip_token';
      v_announce_message := v_character_name || ' won a VIP Token from LL!';
    elsif v_kind = 'moon_box' then
      v_announce_kind := 'lucky_moon_box';
      v_announce_message := v_character_name || ' won a Moon Box from LL!';
    elsif v_kind = 'fallen_star_scroll' then
      v_announce_kind := 'lucky_fallen_star_scroll';
      v_announce_message := v_character_name || ' won a Fallen Star Scroll from LL!';
    elsif v_kind = 'fallen_star' then
      v_announce_kind := 'lucky_fallen_star';
      v_announce_message := v_character_name || ' won a Fallen Star from LL!';
    elsif v_kind = 'money_bag' and v_amount >= 6 then
      v_announce_kind := 'lucky_money_bag';
      v_announce_message := v_character_name || ' won a Class ' || v_amount || ' Money Bag from LL!';
    elsif v_kind = 'composition_stone' and v_amount in (3, 5, 6, 7, 8, 9) then
      v_announce_kind := 'lucky_stone';
      v_announce_message := v_character_name || ' won a +' || v_amount || ' Stone from LL!';
    elsif v_kind like 'gem\_tempered\_%' escape '\' then
      v_announce_kind := 'lucky_gem_tempered';
      v_announce_message := v_character_name || ' won a Tempered ' || initcap(v_gem_id) || ' Gem from LL!';
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

-- Called once per bulk-draw card the instant the player taps it open
-- (LuckyPanel's handleRevealBulkCard). No-ops silently if that index never
-- had a qualifying reward, or was already revealed.
create or replace function public.reveal_lucky_bulk_card(p_character_id uuid, p_card_index integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_pending jsonb;
  v_remaining jsonb := '[]'::jsonb;
  v_entry jsonb;
begin
  select account_id, lucky_bulk_pending_announcements into v_account_id, v_pending
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return;
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(v_pending, '[]'::jsonb))
  loop
    if (v_entry ->> 'index')::integer = p_card_index then
      insert into public.global_announcements (kind, character_name, message)
      values (v_entry ->> 'kind', v_entry ->> 'character_name', v_entry ->> 'message');
    else
      v_remaining := v_remaining || jsonb_build_array(v_entry);
    end if;
  end loop;

  update public.characters set lucky_bulk_pending_announcements = v_remaining where id = p_character_id;
end;
$$;

grant execute on function public.reveal_lucky_bulk_card(uuid, integer) to authenticated;

commit;
