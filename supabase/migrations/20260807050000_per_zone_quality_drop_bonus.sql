-- Per-zone, quality-only Account achievement drop bonus (confirmed with the
-- user, 2026-08-07) — supersedes the flat, single `account_drop_bonus_pct`
-- reward claim_account_achievement_reward used to grant. Two changes,
-- confirmed together:
--
-- 1. The bonus is now tracked PER ZONE, not as one account-wide number.
--    Claiming an account-tier reward on a monster only ever grows that
--    monster's own zone's pool (players.account_zone_drop_bonus_pct, a jsonb
--    map keyed by zone id) — grinding Windhollow's roster pays off
--    specifically while fighting in Windhollow, not everywhere. Each
--    successive zone (Windhollow -> Rimehollow, ZONE_ORDER's own order) has
--    a higher total achievable bonus than the last, via a simple linear
--    per-zone multiplier on the same base per-tier increments — a zone
--    further into the game rewards the same grind more, mirroring how the
--    account track already scales its own thresholds up (500/1250/2500/
--    5000/25000/50000). PLACEHOLDER escalation shape, same
--    disclosed-not-final status as every other economy number in this game.
-- 2. The bonus itself only affects the ODDS OF HIGHER QUALITY on a drop that
--    already happened — never how often a plain item drops at all. See
--    resolve-combat/index.ts's own use of accountDropMultiplier: DROP_CHANCE
--    (whether anything drops) is now unscaled; rollDroppedQualityTier's
--    per-tier odds are the only thing this bonus multiplies. Comet/Fallen
--    Star drop-chance scaling is unchanged in shape, just now reads the
--    zone-scoped value instead of the old flat one.
--
-- account_drop_bonus_pct itself is left in place, unused, rather than
-- dropped — no live data has meaningfully accumulated in it yet (this whole
-- reward category shipped one day earlier, 2026-08-06), and this project's
-- own established convention (see CLAUDE.md's Bank/Warehouse history) is to
-- leave a superseded column alone rather than force a migration to drop it.
alter table public.players add column if not exists account_zone_drop_bonus_pct jsonb not null default '{}'::jsonb;

-- Maps a zone id to its 1-based ZONE_ORDER position (see
-- src/game/zones/zoneData.ts's own ZONE_ORDER — must stay in sync). Used
-- only to scale the per-tier drop-bonus increment below; not exposed to
-- clients.
create or replace function public.zone_drop_bonus_multiplier(p_zone_id text)
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
  end) * 0.5;
$$;

revoke all on function public.zone_drop_bonus_multiplier(text) from public;

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
  v_attack_bonus numeric;
  v_drop_bonus_base numeric;
  v_drop_bonus numeric;
  v_zone_id text;
  v_zone_multiplier numeric;
  v_new_attack_bonus_pct numeric;
  v_new_zone_bonus_pct numeric;
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
  v_zone_multiplier := public.zone_drop_bonus_multiplier(coalesce(v_zone_id, ''));

  -- PLACEHOLDER per-tier increments (percentage points), same escalating
  -- shape as before — attack bonus is unaffected by this migration (still
  -- flat/account-wide, per the user's own request scoping this change to
  -- drop bonus specifically). Drop bonus is now the tier increment scaled
  -- by this monster's own zone (see zone_drop_bonus_multiplier above).
  case v_next_index
    when 1 then v_attack_bonus := 0.05; v_drop_bonus_base := 5;
    when 2 then v_attack_bonus := 0.08; v_drop_bonus_base := 8;
    when 3 then v_attack_bonus := 0.12; v_drop_bonus_base := 12;
    when 4 then v_attack_bonus := 0.20; v_drop_bonus_base := 15;
    when 5 then v_attack_bonus := 0.30; v_drop_bonus_base := 25;
    when 6 then v_attack_bonus := 0.50; v_drop_bonus_base := 40;
  end case;

  v_drop_bonus := v_drop_bonus_base * v_zone_multiplier;

  update public.players
  set account_attack_bonus_pct = account_attack_bonus_pct + v_attack_bonus,
      account_zone_drop_bonus_pct = jsonb_set(
        account_zone_drop_bonus_pct,
        array[coalesce(v_zone_id, 'unknown')],
        to_jsonb(coalesce((account_zone_drop_bonus_pct->>coalesce(v_zone_id, 'unknown'))::numeric, 0) + v_drop_bonus),
        true
      )
  where id = p_account_id
  returning account_attack_bonus_pct, account_zone_drop_bonus_pct->>coalesce(v_zone_id, 'unknown'), account_zone_drop_bonus_pct
  into v_new_attack_bonus_pct, v_new_zone_bonus_pct, v_new_zone_bonuses;

  update public.account_monster_kills set claimed_tier_index = v_next_index
  where account_id = p_account_id and monster_id = p_monster_id;

  return jsonb_build_object(
    'ok', true,
    'claimed_tier_index', v_next_index,
    'attack_bonus_gained', v_attack_bonus,
    'drop_bonus_gained', v_drop_bonus,
    'zone_id', v_zone_id,
    'account_attack_bonus_pct', v_new_attack_bonus_pct,
    'account_zone_drop_bonus_pct', v_new_zone_bonuses
  );
end;
$$;
