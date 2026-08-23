-- Lucky Lad bulk draw: add a Lottery-Ticket payment path ("9 for 8 Lottery
-- Tickets", requested by the user) alongside the existing 160-AP path,
-- mirroring the single-draw's free/1-ticket/20-AP choice. Changes
-- draw_lucky_ticket_bulk's signature from (uuid) to (uuid, boolean default
-- false) — the old single-arg overload must be dropped explicitly first
-- (create or replace with a different arg list creates an ambiguous second
-- overload instead of replacing it, per CLAUDE.md's own gotcha about this).
begin;

drop function if exists public.draw_lucky_ticket_bulk(uuid);

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
    lottery_ticket_count = v_lottery_ticket_count,
    composition_stones = v_composition_stones,
    gems = v_gems
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

revoke all on function public.draw_lucky_ticket_bulk(uuid, boolean) from public;
grant execute on function public.draw_lucky_ticket_bulk(uuid, boolean) to authenticated;

commit;
