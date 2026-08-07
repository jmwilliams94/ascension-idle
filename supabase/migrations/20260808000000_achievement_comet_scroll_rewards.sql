-- Swaps every Fallen Star reward on the Achievements system for a Comet
-- Scroll instead (2026-08-07, confirmed with the user: "replace any reward
-- for a Fallen Star in achievements with a Comet Scroll"), same quantities
-- both places it applied:
--   1. claim_kill_count_reward's character-track tier 5 (was 1 Fallen Star)
--   2. resolve-combat's zone-tier reward (was 1/2/3/4/5/8 Fallen Stars,
--      escalating per zone tier) — now granted through
--      resolve_combat_apply_rewards' new p_comet_scroll_delta parameter
--      instead of being folded into the ordinary dropped-Fallen-Star loop.
--
-- 1. resolve_combat_apply_rewards — add p_comet_scroll_delta. Must DROP the
--    old 7-arg signature first (not just create-or-replace) — adding a
--    parameter creates a second overload rather than replacing the existing
--    one, the same PostgREST-can't-disambiguate gotcha documented elsewhere
--    in this codebase (draw_lucky_ticket's p_use_ticket).
drop function if exists public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, timestamptz);

create or replace function public.resolve_combat_apply_rewards(
  p_character_id uuid,
  p_gold_delta integer,
  p_exp integer,
  p_level integer,
  p_comet_delta integer,
  p_fallen_star_delta integer,
  p_comet_scroll_delta integer default 0,
  p_resolved_at timestamptz default now()
)
returns table (gold integer, comet_count integer, fallen_star_count integer, comet_scroll_count integer)
language plpgsql
as $$
begin
  return query
  update public.characters
  set
    gold = characters.gold + p_gold_delta,
    exp = p_exp,
    level = p_level,
    comet_count = characters.comet_count + p_comet_delta,
    fallen_star_count = characters.fallen_star_count + p_fallen_star_delta,
    comet_scroll_count = characters.comet_scroll_count + p_comet_scroll_delta,
    combat_last_resolved_at = p_resolved_at
  where characters.id = p_character_id
  returning characters.gold, characters.comet_count, characters.fallen_star_count, characters.comet_scroll_count;
end;
$$;

revoke all on function public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, integer, timestamptz) from public;
grant execute on function public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, integer, timestamptz) to service_role;

-- 2. claim_kill_count_reward — tier 5's branch grants a Comet Scroll instead
--    of a Fallen Star now. Signature (uuid, text) is unchanged, so a plain
--    create-or-replace is safe here (no overload risk).
create or replace function public.claim_kill_count_reward(p_character_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_class text;
  v_kills integer;
  v_current_index integer;
  v_next_index integer;
  v_threshold integer;
  v_comets_granted integer := 0;
  v_comet_scrolls_granted integer := 0;
  v_lottery_tickets_granted integer := 0;
  v_new_comets integer;
  v_new_comet_scrolls integer;
  v_new_lottery_tickets integer;
  v_monster_level integer;
  v_template_id uuid;
  v_item jsonb;
begin
  select account_id, class into v_account_id, v_character_class
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select kills, claimed_tier_index into v_kills, v_current_index
  from public.character_monster_kills
  where character_id = p_character_id and monster_id = p_monster_id
  for update;

  if v_kills is null then
    return jsonb_build_object('ok', false, 'error', 'no_kills_yet');
  end if;

  v_current_index := coalesce(v_current_index, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  -- Tier thresholds: 100/250/500/1000/5000/10000 (ACHIEVEMENT_TIERS).
  v_threshold := case v_next_index
    when 1 then 100 when 2 then 250 when 3 then 500
    when 4 then 1000 when 5 then 5000 when 6 then 10000
  end;

  if v_kills < v_threshold then
    return jsonb_build_object('ok', false, 'error', 'not_reached', 'threshold', v_threshold, 'kills', v_kills);
  end if;

  if v_next_index = 6 then
    select level into v_monster_level from public.enemy_types where id = p_monster_id;
    v_template_id := public.pick_infused_reward_template(v_character_class, coalesce(v_monster_level, 1));

    if v_template_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_reward_available');
    end if;

    insert into public.item_instances (template_id, owner_id, quality_tier, level)
    select id, p_character_id, 'infused', required_level
    from public.item_templates
    where id = v_template_id
    returning to_jsonb(item_instances.*) into v_item;
  else
    -- PLACEHOLDER bundle, small on purpose (2026-08-06, confirmed with the
    -- user: "nothing should be a crazy high percentage buff, they should
    -- all be small slight increases"). Tier 5 deliberately moved to a Comet
    -- Scroll (was a Fallen Star, "extremely rare final tier kind of reward"
    -- — switched 2026-08-07, same "extremely rare" placement) — every
    -- earlier tier grants Comets and/or a Lottery Ticket instead.
    case v_next_index
      when 1 then v_comets_granted := 2;
      when 2 then v_comets_granted := 3;
      when 3 then v_lottery_tickets_granted := 1;
      when 4 then v_comets_granted := 5; v_lottery_tickets_granted := 1;
      when 5 then v_comet_scrolls_granted := 1;
    end case;

    if v_comets_granted > 0 then
      update public.characters set comet_count = comet_count + v_comets_granted where id = p_character_id
      returning comet_count into v_new_comets;
    end if;
    if v_comet_scrolls_granted > 0 then
      update public.characters set comet_scroll_count = comet_scroll_count + v_comet_scrolls_granted where id = p_character_id
      returning comet_scroll_count into v_new_comet_scrolls;
    end if;
    if v_lottery_tickets_granted > 0 then
      update public.characters set lottery_ticket_count = lottery_ticket_count + v_lottery_tickets_granted where id = p_character_id
      returning lottery_ticket_count into v_new_lottery_tickets;
    end if;
  end if;

  update public.character_monster_kills set claimed_tier_index = v_next_index
  where character_id = p_character_id and monster_id = p_monster_id;

  return jsonb_build_object(
    'ok', true,
    'claimed_tier_index', v_next_index,
    'comets_granted', v_comets_granted,
    'comet_scrolls_granted', v_comet_scrolls_granted,
    'lottery_tickets_granted', v_lottery_tickets_granted,
    'comets_remaining', v_new_comets,
    'comet_scrolls_remaining', v_new_comet_scrolls,
    'lottery_tickets_remaining', v_new_lottery_tickets,
    'item', v_item
  );
end;
$$;

revoke all on function public.claim_kill_count_reward(uuid, text) from public;
grant execute on function public.claim_kill_count_reward(uuid, text) to authenticated;
