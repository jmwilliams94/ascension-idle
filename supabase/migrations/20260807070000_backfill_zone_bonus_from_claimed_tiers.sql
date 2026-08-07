-- Backfill fix (reported by the user: "I don't think the bonus is taking
-- into account previously achieved tiers"). Root cause: account_zone_
-- attack_bonus_pct/account_zone_drop_bonus_pct were both introduced as new,
-- empty jsonb columns (20260807050000/20260807060000) that only grow when
-- claim_account_achievement_reward is called AGAIN going forward — neither
-- migration backfilled a value from account_monster_kills.claimed_tier_index,
-- which already recorded every tier a player had claimed under the OLD
-- (pre-per-zone, pre-rebalance) reward system. A player who'd already
-- claimed, say, tier 6 on a monster has claimed_tier_index = 6 and can never
-- claim that monster again (already_maxed) — so without this backfill, that
-- monster's real contribution to its zone's bonus pool was permanently
-- missing, with no way to "reclaim" it through the normal claim flow.
--
-- Fix: recompute both jsonb maps from scratch for every account, straight
-- from claimed_tier_index x the current flat per-tier reward formula
-- (1% attack per tier everywhere; zone_quality_bonus_per_tier_pct per tier
-- for drop/quality) — a full REPLACE, not an additive patch, since this is
-- idempotent and always produces the exactly-correct total regardless of
-- what partial data was already sitting in these columns from claims made
-- since the per-zone migration first shipped.
with contributions as (
  select
    amk.account_id,
    et.zone_id,
    amk.claimed_tier_index * 1 as attack_contribution,
    amk.claimed_tier_index * public.zone_quality_bonus_per_tier_pct(et.zone_id) as drop_contribution
  from public.account_monster_kills amk
  join public.enemy_types et on et.id = amk.monster_id
  where amk.claimed_tier_index > 0
    and et.zone_id is not null
),
aggregated as (
  select account_id, zone_id, sum(attack_contribution) as attack_total, sum(drop_contribution) as drop_total
  from contributions
  group by account_id, zone_id
),
per_account as (
  select
    account_id,
    jsonb_object_agg(zone_id, attack_total) as attack_map,
    jsonb_object_agg(zone_id, drop_total) as drop_map
  from aggregated
  group by account_id
)
update public.players p
set account_zone_attack_bonus_pct = pa.attack_map,
    account_zone_drop_bonus_pct = pa.drop_map
from per_account pa
where pa.account_id = p.id;
