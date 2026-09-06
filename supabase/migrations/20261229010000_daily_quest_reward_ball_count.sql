-- Adds 'ball_count' to quality_order's non-max-level EXP reward so the new
-- claim reveal popup (requested by the user, 2026-09-06) can show "N
-- Experience Orb icons" rather than just a raw EXP number -- the
-- lottery_ticket branch already exposes this via its own 'amount' field, so
-- only the 'exp' branch needed the addition. Full body otherwise unchanged
-- from the live version.
begin;

create or replace function public.claim_daily_quest(p_character_id uuid, p_slot integer, p_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_level integer;
  v_exp bigint;
  v_quests jsonb;
  v_quest jsonb;
  v_type text;
  v_target jsonb;
  v_progress numeric;
  v_claimed boolean;
  v_ball_count integer;
  v_exp_gain bigint;
  v_new_exp bigint;
  v_new_level integer;
  v_required bigint;
  v_lottery_tickets integer;
  v_item_owner uuid;
  v_item_location text;
  v_item_quality text;
  v_item_slot_type text;
  v_equipped_ids uuid[];
  v_money_bag_result jsonb;
  v_reward jsonb;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
begin
  select account_id, level, exp,
         array_remove(array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                             equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id], null)
  into v_account_id, v_level, v_exp, v_equipped_ids
  from public.characters where id = p_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_quests := public.ensure_daily_quests_state(p_character_id);

  if p_slot < 0 or p_slot > 2 or jsonb_array_length(v_quests) <= p_slot then
    return jsonb_build_object('ok', false, 'error', 'invalid_slot');
  end if;

  v_quest := v_quests -> p_slot;
  v_type := v_quest ->> 'type';
  v_target := v_quest -> 'target';
  v_progress := coalesce((v_quest ->> 'progress')::numeric, 0);
  v_claimed := (v_quest ->> 'claimed')::boolean;

  if v_claimed then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  if v_type = 'quality_order' then
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'error', 'item_required');
    end if;

    select ii.owner_id, ii.location, ii.quality_tier, it.slot_type
    into v_item_owner, v_item_location, v_item_quality, v_item_slot_type
    from public.item_instances ii join public.item_templates it on it.id = ii.template_id
    where ii.id = p_item_id for update;

    if v_item_owner is distinct from p_character_id or v_item_location <> 'inventory'
       or p_item_id = any(v_equipped_ids) or v_item_slot_type <> (v_target ->> 'slot_type')
       or v_item_quality not in ('tempered', 'infused', 'radiant', 'ascended') then
      return jsonb_build_object('ok', false, 'error', 'item_ineligible');
    end if;

    v_ball_count := case v_item_quality
      when 'tempered' then 1 when 'infused' then 2 when 'radiant' then 3 else 5 end;

    delete from public.item_instances where id = p_item_id;

    if v_level >= 130 then
      v_lottery_tickets := v_ball_count;
      update public.characters set lottery_ticket_count = lottery_ticket_count + v_lottery_tickets
      where id = p_character_id returning lottery_ticket_count into v_lottery_tickets;
      v_reward := jsonb_build_object('kind', 'lottery_ticket', 'amount', v_ball_count, 'lottery_ticket_count', v_lottery_tickets);
    else
      v_exp_gain := round(public.required_exp_for_level(v_level) * public.experience_orb_percent_for_level(v_level) * v_ball_count);
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
      update public.characters set exp = v_new_exp, level = v_new_level where id = p_character_id;
      v_reward := jsonb_build_object('kind', 'exp', 'amount', v_exp_gain, 'exp', v_new_exp, 'level', v_new_level, 'ball_count', v_ball_count);
    end if;

  elsif v_type = 'kill_count' then
    if v_progress < (v_target ->> 'required_kills')::numeric then
      return jsonb_build_object('ok', false, 'error', 'not_complete');
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
    set exp = v_new_exp, level = v_new_level, comet_scroll_count = comet_scroll_count + 1
    where id = p_character_id
    returning comet_scroll_count into v_comet_scroll_count;

    v_reward := jsonb_build_object(
      'kind', 'exp_and_comet_scroll', 'exp_amount', v_exp_gain, 'exp', v_new_exp, 'level', v_new_level,
      'comet_scroll_count', v_comet_scroll_count
    );

  elsif v_type in ('world_boss_attacks', 'gold_donation') then
    if v_type = 'world_boss_attacks' and v_progress < (v_target ->> 'required_attacks')::numeric then
      return jsonb_build_object('ok', false, 'error', 'not_complete');
    end if;
    if v_type = 'gold_donation' and v_progress < 1 then
      return jsonb_build_object('ok', false, 'error', 'not_complete');
    end if;

    v_money_bag_result := public.grant_daily_quest_money_bag(p_character_id);
    if not (v_money_bag_result ->> 'ok')::boolean then
      return jsonb_build_object('ok', false, 'error', v_money_bag_result ->> 'error');
    end if;
    v_reward := jsonb_build_object('kind', 'money_bag', 'item', v_money_bag_result -> 'item');

  elsif v_type = 'socket_obtain' then
    if v_progress < 1 then
      return jsonb_build_object('ok', false, 'error', 'not_complete');
    end if;
    update public.characters set fallen_star_scroll_count = fallen_star_scroll_count + 1 where id = p_character_id
    returning fallen_star_scroll_count into v_fallen_star_scroll_count;
    v_reward := jsonb_build_object('kind', 'fallen_star_scroll', 'amount', 1, 'fallen_star_scroll_count', v_fallen_star_scroll_count);
  end if;

  v_quests := jsonb_set(v_quests, array[p_slot::text, 'claimed'], 'true'::jsonb);
  update public.character_daily_quests set quests = v_quests, updated_at = now() where character_id = p_character_id;

  return jsonb_build_object('ok', true, 'reward', v_reward, 'quests', v_quests);
end;
$$;

revoke all on function public.claim_daily_quest(uuid, integer, uuid) from public;
grant execute on function public.claim_daily_quest(uuid, integer, uuid) to authenticated;

commit;
