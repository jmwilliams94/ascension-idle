-- Salvage AP payout — corrected (confirmed with the user, 2026-08-07) to
-- exactly match sell_item's own quality->AP mapping (Tempered 1, Infused 2,
-- Radiant 3, Ascended 4, Normal 0) — supersedes the original "roughly double
-- sell_item, plus a token 1 for Normal" design from Salvage's first pass.
-- Salvage's differentiator is simply "AP only, no gold," not a better AP
-- rate than selling.
create or replace function public.salvage_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_quality_tier text;
  v_ap_gained integer;
  v_new_ap integer;
begin
  select owner_id, quality_tier into v_character_id, v_quality_tier
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_ap_gained := case v_quality_tier
    when 'tempered' then 1
    when 'infused' then 2
    when 'radiant' then 3
    when 'ascended' then 4
    else 0
  end;

  delete from public.item_instances where id = item_id;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;

-- Account achievement Attack Bonus made per-zone (confirmed with the user,
-- 2026-08-07 — "That attack bonus... should apply the same way we just
-- fixed up quality to apply. I hope it's not a global attack bonus.") — it
-- was: players.account_attack_bonus_pct is a flat scalar applied to every
-- fight regardless of zone, the exact thing the drop-bonus fix the day
-- before had just corrected for drop bonus specifically. Supersedes
-- account_attack_bonus_pct with a per-zone jsonb map, same shape as
-- account_zone_drop_bonus_pct — only active while fighting in the zone it
-- was earned in.
--
-- Both reward magnitudes also rebalanced in the same pass (confirmed with
-- the user): every one of the 6 tiers now grants the SAME flat amount (not
-- an escalating 0.05/0.08/0.12/.../0.5-style table) "so for the zone it
-- would total up nicer" — 5 monsters x 6 tiers x a flat per-tier amount
-- gives a clean round zone total. Attack: flat 1% per tier, identical in
-- every zone (no zone escalation — the user only asked for quality to scale
-- by zone). Quality: 1% per tier at Windhollow, +0.25 percentage points per
-- tier for every zone step after that (the user's own example: "the next
-- zone is 1.25% per tier") — supersedes zone_drop_bonus_multiplier's old
-- "x1.5 per zone step" shape with a direct per-tier value instead.
alter table public.players add column if not exists account_zone_attack_bonus_pct jsonb not null default '{}'::jsonb;

drop function if exists public.zone_drop_bonus_multiplier(text);

-- Direct per-tier quality-bonus percentage for a zone (not a multiplier
-- anymore) — 1% at Windhollow (index 0), +0.25 per ZONE_ORDER step after
-- that. Mirrors zoneDropBonusMultiplier's replacement in achievementData.ts
-- — keep in sync.
create or replace function public.zone_quality_bonus_per_tier_pct(p_zone_id text)
returns numeric
language sql
immutable
as $$
  select 1 + (case p_zone_id
    when 'windhollow' then 0
    when 'cinderleaf' then 1
    when 'stormvale' then 2
    when 'sunscar-wastes' then 3
    when 'talon-isle' then 4
    when 'duskspire-keep' then 5
    when 'twistpath-ruins' then 6
    when 'rimehollow' then 7
    else 0
  end) * 0.25;
$$;

revoke all on function public.zone_quality_bonus_per_tier_pct(text) from public;

create or replace function public.claim_account_achievement_reward(p_account_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kills integer;
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
