-- Daily Quests -- each character rolls 3 of 5 possible daily quests, reset at
-- UTC midnight (lazy roll-on-read, same "ensure_X" idiom as
-- ensure_world_boss_spawn/ensure_gold_donation_pool -- no pg_cron involved).
-- Per-character, not account-wide (confirmed with the user) -- this is NOT
-- the character-deletion footgun documented elsewhere in CLAUDE.md (that
-- rule guards a cooldown gating a *shared/scarce account resource*, e.g.
-- Lucky Lad's free ticket; deleting a character here just forfeits that
-- character's own daily progress, same as it already forfeits its kill-count
-- ladder progress).
--
-- 5 quest types, `quests` jsonb array of exactly 3 `{slot, type, target,
-- progress, claimed}` objects:
--   quality_order      -- turn in (consumed) an owned Tempered+ item of a
--                         random slot_type; reward scales with the quality
--                         submitted (1/2/3/5 "exp balls" worth of EXP, or
--                         that many Lottery Tickets at max level).
--   kill_count         -- kill one specific randomly-picked monster (at or
--                         below the character's level) 100-1000 times;
--                         reward = 1 exp ball worth of EXP + 1 Comet Scroll.
--   world_boss_attacks -- attack a World Boss 5 times (cumulative for the
--                         day, NOT the same counter as
--                         world_boss_participants.free/paid_attempts_used,
--                         which resets per-spawn not per-day); reward = a
--                         random Money Bag, same relative weights as Lucky
--                         Lad's money_bag rows.
--   gold_donation      -- donate any amount to the Gold Donation event;
--                         reward = a random Money Bag (same as above).
--   socket_obtain      -- land a new socket via any Forge upgrade path;
--                         reward = 1 Fallen Star Scroll.
--
-- "1 exp ball's worth of EXP" reuses required_exp_for_level/
-- experience_orb_percent_for_level from 20261206000000_experience_orb_and_
-- potion.sql (already standalone plpgsql functions) -- this is a disclosed,
-- already-established 4th copy of that curve (client TS, Deno edge
-- function, plpgsql x2) per that migration's own header comment.
--
-- Progress is server-verified, not client-trusted: bump_daily_quest_progress
-- below is called from inside the 4 authoritative write-paths for these
-- actions (resolve_combat_apply_results, apply_world_boss_attack,
-- donate_gold, and all 5 socket-granting upgrade functions) in 4 follow-up
-- migrations, not from a client-callable increment RPC.
begin;

create table public.character_daily_quests (
  character_id uuid primary key references public.characters (id) on delete cascade,
  reset_date date not null,
  quests jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.character_daily_quests enable row level security;

create policy "Characters can view their own daily quests"
  on public.character_daily_quests for select
  using (exists (select 1 from public.characters c where c.id = character_daily_quests.character_id and c.account_id = auth.uid()));

-- No insert/update/delete grant to authenticated -- every mutation happens
-- through ensure_daily_quests/claim_daily_quest (SECURITY DEFINER, runs as
-- owner) or the hook functions below (some SECURITY DEFINER, some plain
-- service-role-only -- see the 4 follow-up hook migrations), same lockdown
-- pattern as character_monster_kills.
grant select on public.character_daily_quests to authenticated;
grant all on public.character_daily_quests to service_role;

-- ============================================================================
-- 1. pick_daily_quest_money_bag_class -- weighted-random pick over the same
--    relative weights as pick_lucky_reward's money_bag rows (12.66, 10.71,
--    6.25, 3.57, 5.5, 2.0, 0.7, 0.3, 0.3, 0.1 for classes 1-10, summing to
--    42.09 out of that function's full 100). Rolling against the raw,
--    unscaled weights (random() * 42.09) is mathematically identical to
--    renormalizing to 100 first -- skips an unnecessary scaling step.
-- ============================================================================
create or replace function public.pick_daily_quest_money_bag_class()
returns integer
language plpgsql
as $$
declare
  v_roll numeric := random() * 42.09;
  v_cumulative numeric := 0;
  v_row record;
begin
  for v_row in
    select * from (values
      (1, 12.66::numeric), (2, 10.71::numeric), (3, 6.25::numeric), (4, 3.57::numeric), (5, 5.5::numeric),
      (6, 2.0::numeric), (7, 0.7::numeric), (8, 0.3::numeric), (9, 0.3::numeric), (10, 0.1::numeric)
    ) as t(class, weight)
    order by t.class
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return v_row.class;
    end if;
  end loop;
  return 1; -- floating-point fallback, mirrors pick_lucky_reward's own fallback pattern
end;
$$;

-- ============================================================================
-- 2. grant_daily_quest_money_bag -- duplicates draw_lucky_ticket's money_bag
--    branch verbatim (occupied-room check + item_instances insert), a 3rd
--    copy of that room-check block alongside the single-draw and bulk-draw
--    versions in 20261206000000_experience_orb_and_potion.sql -- kept
--    duplicated rather than extracted, consistent with every existing copy.
-- ============================================================================
create or replace function public.grant_daily_quest_money_bag(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_class integer := public.pick_daily_quest_money_bag_class();
  v_template_id uuid;
  v_slot_type text;
  v_equipped_ids uuid[];
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_occupied integer;
  v_new_item item_instances%rowtype;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_comet_box_count integer;
  v_vip_token_count integer;
  v_experience_orb_count integer;
  v_experience_potion_count integer;
begin
  select composition_stones, gems, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         comet_box_count, vip_token_count, experience_orb_count, experience_potion_count,
         array_remove(array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                             equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id], null)
  into v_composition_stones, v_gems, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_comet_box_count, v_vip_token_count, v_experience_orb_count, v_experience_potion_count, v_equipped_ids
  from public.characters where id = p_character_id;

  select count(*) into v_gear_count from public.item_instances
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids));
  select coalesce(sum((value)::integer), 0) into v_stone_count from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));
  select coalesce(sum((value)::integer), 0) into v_gem_count from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));
  select count(*) into v_potion_count from public.potion_stacks where character_id = p_character_id and count > 0;

  v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
    + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count
    + v_comet_box_count + v_vip_token_count + v_experience_orb_count + v_experience_potion_count;

  if v_occupied >= 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room');
  end if;

  select id, slot_type into v_template_id, v_slot_type from public.item_templates where name = 'Class ' || v_class || ' Money Bag';

  insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
  values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 1), 0))
  returning * into v_new_item;

  return jsonb_build_object('ok', true, 'item', to_jsonb(v_new_item));
end;
$$;

-- ============================================================================
-- 3. roll_daily_quests -- picks 3 of the 5 types without replacement, builds
--    each quest's target, upserts the row for "today" (UTC).
-- ============================================================================
create or replace function public.roll_daily_quests(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_types text[];
  v_level integer;
  v_quests jsonb := '[]'::jsonb;
  v_slot_type text;
  v_monster_id text;
  v_required_kills integer;
  i integer;
begin
  select level into v_level from public.characters where id = p_character_id;

  select array_agg(t) into v_types from (
    select t from unnest(array['quality_order', 'kill_count', 'world_boss_attacks', 'gold_donation', 'socket_obtain']) as t
    order by random() limit 3
  ) s;

  for i in 1..3 loop
    if v_types[i] = 'quality_order' then
      v_slot_type := (array['weapon', 'ring', 'necklace', 'boots', 'hat', 'coat', 'quiver'])[1 + floor(random() * 7)::int];
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', 'quality_order', 'target', jsonb_build_object('slot_type', v_slot_type),
        'progress', 0, 'claimed', false));
    elsif v_types[i] = 'kill_count' then
      select id into v_monster_id from public.enemy_types where level <= v_level order by random() limit 1;
      v_required_kills := 100 + floor(random() * 901)::int;
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', 'kill_count',
        'target', jsonb_build_object('monster_id', v_monster_id, 'required_kills', v_required_kills),
        'progress', 0, 'claimed', false));
    elsif v_types[i] = 'world_boss_attacks' then
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', 'world_boss_attacks', 'target', jsonb_build_object('required_attacks', 5),
        'progress', 0, 'claimed', false));
    else
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', v_types[i], 'target', '{}'::jsonb, 'progress', 0, 'claimed', false));
    end if;
  end loop;

  insert into public.character_daily_quests (character_id, reset_date, quests, updated_at)
  values (p_character_id, (now() at time zone 'utc')::date, v_quests, now())
  on conflict (character_id) do update
    set reset_date = excluded.reset_date, quests = excluded.quests, updated_at = now();

  return v_quests;
end;
$$;

-- ============================================================================
-- 4. ensure_daily_quests_state -- internal: rerolls if no row exists yet or
--    reset_date is stale (a new UTC calendar day has started), else returns
--    the existing set unchanged.
-- ============================================================================
create or replace function public.ensure_daily_quests_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_reset_date date;
  v_quests jsonb;
begin
  select reset_date, quests into v_reset_date, v_quests
  from public.character_daily_quests where character_id = p_character_id for update;

  if not found or v_reset_date <> (now() at time zone 'utc')::date then
    v_quests := public.roll_daily_quests(p_character_id);
  end if;

  return v_quests;
end;
$$;

-- ============================================================================
-- 5. ensure_daily_quests -- public RPC, ownership-checked.
-- ============================================================================
create or replace function public.ensure_daily_quests(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_quests jsonb;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_quests := public.ensure_daily_quests_state(p_character_id);
  return jsonb_build_object('ok', true, 'quests', v_quests);
end;
$$;

revoke all on function public.ensure_daily_quests(uuid) from public;
grant execute on function public.ensure_daily_quests(uuid) to authenticated;

-- ============================================================================
-- 6. bump_daily_quest_progress -- internal helper, deliberately left with
--    default PUBLIC execute (no revoke) so it's callable both from
--    SECURITY DEFINER RPCs (running as owner) and from the plain,
--    service-role-only functions it's hooked into (resolve_combat_apply_
--    results, apply_world_boss_attack) -- revoking from public here would
--    reproduce the exact "helper needs an explicit grant to every calling
--    role" gotcha this project already got bitten by once
--    (compute_max_durability, see CLAUDE.md).
-- ============================================================================
create or replace function public.bump_daily_quest_progress(
  p_character_id uuid,
  p_quest_type text,
  p_monster_id text default null,
  p_amount numeric default 1
)
returns void
language plpgsql
as $$
declare
  v_quests jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_quest jsonb;
  v_required numeric;
  v_matches boolean;
begin
  v_quests := public.ensure_daily_quests_state(p_character_id);

  for v_quest in select * from jsonb_array_elements(v_quests)
  loop
    v_matches :=
      (v_quest ->> 'type') = p_quest_type
      and not (v_quest ->> 'claimed')::boolean
      and (p_monster_id is null or (v_quest -> 'target' ->> 'monster_id') = p_monster_id);

    if v_matches then
      v_required := coalesce((v_quest -> 'target' ->> 'required_kills')::numeric, (v_quest -> 'target' ->> 'required_attacks')::numeric, 1);
      v_quest := jsonb_set(v_quest, '{progress}', to_jsonb(least(coalesce((v_quest ->> 'progress')::numeric, 0) + p_amount, v_required)));
    end if;

    v_updated := v_updated || jsonb_build_array(v_quest);
  end loop;

  update public.character_daily_quests set quests = v_updated, updated_at = now() where character_id = p_character_id;
end;
$$;

-- ============================================================================
-- 7. claim_daily_quest -- public RPC, ownership-checked, locks the character
--    row for the whole claim (same pattern as use_experience_orb/
--    draw_lucky_ticket) so a concurrent claim/spend can't race the same
--    character row.
-- ============================================================================
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
      when 'tempered' then 1 when 'infused' then 2 when 'radiant' then 3 else 5 end; -- 'ascended'

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
      v_reward := jsonb_build_object('kind', 'exp', 'amount', v_exp_gain, 'exp', v_new_exp, 'level', v_new_level);
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
