-- Zone Tier rewards become a real Claim button, matching the per-monster
-- Kill Count ladder's own shape (confirmed with the user, 2026-08-15: "those
-- being given straight to an inventory with no reason why is a little
-- confusing"). Supersedes resolve-combat's own auto-grant of Comet Scrolls
-- on crossing a zone-tier threshold (5/10/15/20/25/30 tier-completions
-- across a zone's 5 monsters x 6 kill-count tiers) — that code is deleted
-- from supabase/functions/resolve-combat/index.ts in this same change.
--
-- character_zone_progress.highest_zone_tier_granted meant "highest tier
-- resolve-combat has already silently paid out" — renamed to
-- claimed_zone_tier, now meaning "highest tier the player has manually
-- claimed," written only by the new claim_zone_tier_reward RPC below
-- (mirrors character_monster_kills.claimed_tier_index / claim_kill_count_reward).
begin;

alter table public.character_zone_progress
  rename column highest_zone_tier_granted to claimed_zone_tier;

-- ============================================================================
-- claim_zone_tier_reward — claims the NEXT zone tier in sequence (same
-- "caller never picks which tier" shape as claim_kill_count_reward) for one
-- character's zone. Free (no currency cost) — recomputes the zone's total
-- tier-completions live from character_monster_kills (same math as
-- src/game/achievements/achievementData.ts's zoneTierCompletions /
-- resolve-combat's own former mirror — keep in sync) rather than trusting
-- any cached total.
-- ============================================================================
create or replace function public.claim_zone_tier_reward(p_character_id uuid, p_zone_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_current_index integer;
  v_next_index integer;
  v_threshold integer;
  v_completions integer;
  v_reward integer;
  v_new_scrolls integer;
begin
  select account_id into v_account_id
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  -- Sums, per zone monster, how many of the 6 kill-count tiers
  -- (100/250/500/1000/5000/10000) that monster's kills have reached — a zone
  -- has 5 monsters x 6 tiers = 30 possible completions. Mirrors
  -- achievementData.ts's zoneTierCompletions.
  select coalesce(sum(
    (select count(*) from unnest(array[100, 250, 500, 1000, 5000, 10000]) as t(threshold)
     where coalesce(cmk.kills, 0) >= t.threshold)
  ), 0) into v_completions
  from public.enemy_types et
  left join public.character_monster_kills cmk
    on cmk.character_id = p_character_id and cmk.monster_id = et.id
  where et.zone_id = p_zone_id;

  select claimed_zone_tier into v_current_index
  from public.character_zone_progress
  where character_id = p_character_id and zone_id = p_zone_id
  for update;

  v_current_index := coalesce(v_current_index, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  -- Zone tier thresholds: 5/10/15/20/25/30 (ZONE_TIER_COMPLETIONS).
  v_threshold := case v_next_index
    when 1 then 5 when 2 then 10 when 3 then 15
    when 4 then 20 when 5 then 25 when 6 then 30
  end;

  if v_completions < v_threshold then
    return jsonb_build_object('ok', false, 'error', 'not_reached', 'threshold', v_threshold, 'completions', v_completions);
  end if;

  -- Comet Scroll reward per zone tier: 1/2/3/4/5/8 (ZONE_TIER_COMET_SCROLL_REWARD).
  v_reward := case v_next_index
    when 1 then 1 when 2 then 2 when 3 then 3
    when 4 then 4 when 5 then 5 when 6 then 8
  end;

  update public.characters set comet_scroll_count = comet_scroll_count + v_reward
  where id = p_character_id
  returning comet_scroll_count into v_new_scrolls;

  insert into public.character_zone_progress (character_id, zone_id, claimed_zone_tier)
  values (p_character_id, p_zone_id, v_next_index)
  on conflict (character_id, zone_id) do update set claimed_zone_tier = v_next_index;

  return jsonb_build_object(
    'ok', true,
    'claimed_zone_tier', v_next_index,
    'comet_scrolls_granted', v_reward,
    'comet_scrolls_remaining', v_new_scrolls,
    'completions', v_completions,
    'threshold', v_threshold
  );
end;
$$;

revoke all on function public.claim_zone_tier_reward(uuid, text) from public;
grant execute on function public.claim_zone_tier_reward(uuid, text) to authenticated;

commit;
