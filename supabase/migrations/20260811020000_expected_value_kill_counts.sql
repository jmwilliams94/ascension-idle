-- Part of the expected-value combat reward rewrite (see CLAUDE.md's Combat
-- section) — resolve-combat's reward loop moves from per-attack RNG
-- simulation to deterministic closed-form math, which means the number of
-- kills credited per resolve window (expectedKillsPerWindow) is now
-- genuinely fractional. Rounding/flooring that away every ~4s resolve would
-- silently discard most of a player's Achievements progress (small
-- fractional deltas rounding to 0 almost every time). Widening `kills` to
-- numeric lets fractional progress accumulate exactly across resolves —
-- the same "carry the remainder forward" idea the EXP level-up loop already
-- uses, just reusing this existing column instead of adding a separate
-- remainder column. Display layers floor it for players (see
-- AchievementsPanel.tsx) — nobody ever sees a fractional kill count.
alter table public.character_monster_kills alter column kills type numeric using kills::numeric;
alter table public.character_monster_kills alter column kills set default 0;

alter table public.account_monster_kills alter column kills type numeric using kills::numeric;
alter table public.account_monster_kills alter column kills set default 0;

-- resolve_combat_apply_kill_counts (added 1.73.5) — p_kills_delta becomes
-- numeric to match. A parameter *type* change creates a new overload rather
-- than replacing the old one (same PostgREST-can't-disambiguate gotcha
-- documented elsewhere in this codebase), so the old integer-arg signature
-- must be dropped explicitly first.
drop function if exists public.resolve_combat_apply_kill_counts(uuid, uuid, text, integer);

create or replace function public.resolve_combat_apply_kill_counts(
  p_character_id uuid,
  p_account_id uuid,
  p_monster_id text,
  p_kills_delta numeric
)
returns table (character_kills numeric, account_kills numeric)
language plpgsql
as $$
declare
  v_character_kills numeric;
  v_account_kills numeric;
begin
  insert into public.character_monster_kills (character_id, monster_id, kills)
  values (p_character_id, p_monster_id, p_kills_delta)
  on conflict (character_id, monster_id)
  do update set kills = public.character_monster_kills.kills + excluded.kills
  returning kills into v_character_kills;

  insert into public.account_monster_kills (account_id, monster_id, kills)
  values (p_account_id, p_monster_id, p_kills_delta)
  on conflict (account_id, monster_id)
  do update set kills = public.account_monster_kills.kills + excluded.kills
  returning kills into v_account_kills;

  return query select v_character_kills, v_account_kills;
end;
$$;

revoke all on function public.resolve_combat_apply_kill_counts(uuid, uuid, text, numeric) from public;
grant execute on function public.resolve_combat_apply_kill_counts(uuid, uuid, text, numeric) to service_role;

-- claim_kill_count_reward / claim_account_achievement_reward — v_kills
-- widened from integer to numeric to match the column (an integer variable
-- would silently round a fractional `kills` value on read, e.g. 523.7 -> 524
-- via Postgres's assignment-cast rounding). Signatures (uuid, text)
-- unchanged, so a plain create-or-replace is safe here (no overload risk) —
-- both functions' threshold comparisons (`v_kills < v_threshold`,
-- `v_kills >= v_threshold`) already work fine between numeric and the
-- existing integer threshold literals.
create or replace function public.claim_kill_count_reward(p_character_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_class text;
  v_kills numeric;
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

create or replace function public.claim_account_achievement_reward(p_account_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kills numeric;
  v_current_index integer;
  v_next_index integer;
  v_threshold integer;
  v_attack_bonus numeric := 1;
  v_drop_bonus numeric;
  v_zone_id text;
  v_zone_key text;
  v_new_attack_bonus_pct numeric;
  v_new_drop_bonus_pct numeric;
  v_new_attack_bonuses jsonb;
  v_new_zone_bonuses jsonb;
begin
  if p_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select kills, claimed_tier_index into v_kills, v_current_index
  from public.account_monster_kills
  where account_id = p_account_id and monster_id = p_monster_id
  for update;

  if v_kills is null then
    return jsonb_build_object('ok', false, 'error', 'no_kills_yet');
  end if;

  v_current_index := coalesce(v_current_index, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  -- 5x the character track's own thresholds.
  v_threshold := case v_next_index
    when 1 then 500 when 2 then 1250 when 3 then 2500
    when 4 then 5000 when 5 then 25000 when 6 then 50000
  end;

  if v_kills < v_threshold then
    return jsonb_build_object('ok', false, 'error', 'not_reached', 'threshold', v_threshold, 'kills', v_kills);
  end if;

  select zone_id into v_zone_id from public.enemy_types where id = p_monster_id;
  v_zone_key := coalesce(v_zone_id, 'unknown');
  v_drop_bonus := public.zone_quality_bonus_per_tier_pct(v_zone_key);

  update public.players
  set account_zone_attack_bonus_pct = jsonb_set(
        account_zone_attack_bonus_pct,
        array[v_zone_key],
        to_jsonb(coalesce((account_zone_attack_bonus_pct->>v_zone_key)::numeric, 0) + v_attack_bonus),
        true
      ),
      account_zone_drop_bonus_pct = jsonb_set(
        account_zone_drop_bonus_pct,
        array[v_zone_key],
        to_jsonb(coalesce((account_zone_drop_bonus_pct->>v_zone_key)::numeric, 0) + v_drop_bonus),
        true
      )
  where id = p_account_id
  returning
    account_zone_attack_bonus_pct->>v_zone_key,
    account_zone_drop_bonus_pct->>v_zone_key,
    account_zone_attack_bonus_pct,
    account_zone_drop_bonus_pct
  into v_new_attack_bonus_pct, v_new_drop_bonus_pct, v_new_attack_bonuses, v_new_zone_bonuses;

  update public.account_monster_kills set claimed_tier_index = v_next_index
  where account_id = p_account_id and monster_id = p_monster_id;

  return jsonb_build_object(
    'ok', true,
    'claimed_tier_index', v_next_index,
    'attack_bonus_gained', v_attack_bonus,
    'drop_bonus_gained', v_drop_bonus,
    'zone_id', v_zone_id,
    'account_zone_attack_bonus_pct', v_new_attack_bonuses,
    'account_zone_drop_bonus_pct', v_new_zone_bonuses
  );
end;
$$;

revoke all on function public.claim_account_achievement_reward(uuid, text) from public;
grant execute on function public.claim_account_achievement_reward(uuid, text) to authenticated;
