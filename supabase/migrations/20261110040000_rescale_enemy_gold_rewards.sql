-- Kill gold rescale (requested by the user, 2026-08-29): 10 gold at level 1
-- scaling up to ~250 gold at level 129/130, replacing the old 2-21g curve.
-- Same geometric-interpolation shape already used for computeRepairCost.
-- Rare kills keep their existing 5x multiplier (RARE_REWARD_MULTIPLIER),
-- untouched by this change. Mirrored client-side in
-- src/game/zones/zoneData.ts's ENEMY_TYPES.goldReward (same formula, applied
-- to each entry's own `level`) — must stay in sync per this repo's
-- resolve-combat duplication rule.
update public.enemy_types
set gold_reward = round(10 * power(25, (level - 1) / 129.0));
