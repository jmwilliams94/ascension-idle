-- Revert 20261214000000_hunter_bow_weapon_rebalance.sql.
--
-- That migration buffed Bow's physical_attack ~9-10x to match a Wuxia's
-- total magic output against normal monsters, on the mistaken assumption
-- that Hunter and Wuxia damage against normal monsters was currently
-- imbalanced. It isn't: combatResolver.ts's MONSTER_MAGIC_DEFENSE_ANCHORS
-- table (added in the Nov 2026 rebalance, see CLAUDE.combat-and-loot.md) is
-- a dedicated monster-side magic-defense curve, hand-derived specifically
-- from Bow/Ring/Backsword/Bracelet's ORIGINAL base_stats, that already
-- equalizes net damage/hit between a level-matched Hunter and Wuxia against
-- normal monsters. Buffing Bow's raw attack without recomputing that whole
-- table (itself derived from Bow's numbers) doesn't restore parity — it
-- makes Hunter wildly overshoot the game's ~6-9-hits-per-kill pacing target
-- against every normal monster, since monsterDefense (the physical side)
-- was never touched. The real, narrower problem (a Wuxia out-damaging a
-- Hunter) only exists against Zone Boss, which uses a separate, much
-- less-tuned defense mechanism — see the companion
-- world-boss-attack/index.ts specialty-side damage penalty (v1.130.0)
-- instead, which is Zone-Boss-scoped and doesn't touch normal monsters.

begin;

update public.item_templates
set base_stats = jsonb_set(
  base_stats,
  '{physical_attack}',
  to_jsonb(
    case required_level
      when 8 then 7
      when 15 then 8
      when 20 then 9
      when 25 then 11
      when 30 then 12
      when 35 then 14
      when 40 then 16
      when 45 then 18
      when 50 then 20
      when 55 then 23
      when 60 then 26
      when 65 then 30
      when 70 then 34
      when 75 then 38
      when 80 then 44
      when 85 then 50
      when 90 then 56
      when 95 then 64
      when 100 then 73
      when 105 then 83
      when 110 then 94
      when 115 then 107
      when 120 then 121
      when 121 then 124
      when 122 then 127
      when 123 then 131
      when 124 then 134
      when 125 then 137
      when 126 then 141
      when 127 then 145
      when 128 then 148
      when 129 then 152
      when 130 then 156
    end
  )
)
where item_family = 'bow';

commit;
