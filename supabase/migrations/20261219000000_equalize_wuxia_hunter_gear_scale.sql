-- Equalizes Wuxia's gear-side raw attack numbers to Hunter's, across the
-- WHOLE curve (not just the >110 tail fixed in 20261216000000).
--
-- Root cause (reported by the user: "Wuxia is far more overpowered than
-- Hunters as it currently stands"): the previous fix only closed the gap at
-- the exact baseline MONSTER_MAGIC_DEFENSE_ANCHORS was calibrated against
-- (Infused quality, +0 composition, no gems) -- which it does, at every
-- level. But Backsword/Bracelet's raw magic_attack numbers were still ~3.5x
-- Bow/Ring's raw physical_attack numbers at the same level (e.g. level 130:
-- 899 vs 250). Composition (computed off each item's own raw base_stat) and
-- socketed gem bonuses (a % multiplier on the whole attack subtotal) both
-- scale with that raw magnitude -- so the exact same percentage upgrade
-- (Ascended quality, +7 composition, 2 Ascended gems) added ~2.1-2.5x more
-- ABSOLUTE damage to Wuxia than to an identically-invested Hunter, at every
-- level, not just past 110. The monster-side defense table can't counter
-- this on its own since it's a fixed number that doesn't react to the
-- attacker's own gear investment.
--
-- Fix: Backsword's physical_attack/magic_attack and Bracelet's magic_attack
-- are set to literally match Bow's/Ring's own real published values at the
-- same required_level (Backsword shares every required_level Bow has from
-- 15-130 -- copied directly; its three levels below Bow's own start, 1/5/10,
-- use Bow's own compounding formula, 7 * 1.02577^(level-8), evaluated at
-- those levels). Bracelet's required_levels don't overlap Ring's at all, so
-- its values are Ring's own formula, 2 * 1.03128^(level-1), evaluated at
-- Bracelet's own levels. With gear now identical in magnitude, any
-- percentage-based bonus adds a near-identical absolute amount to both
-- classes' weapon+ring contribution.
--
-- The remaining, much smaller asymmetry: Spirit's own attribute
-- contribution (up to 265 at level 130) is still ~3.15x Strength's (84) --
-- an intentional class-identity difference in classes.ts, not touched here
-- -- and gem bonuses multiply the WHOLE attack subtotal (attribute + gear),
-- so a Wuxia still nets a somewhat bigger absolute gem bonus purely from
-- that attribute gap. Verified: at level 130, an identically-built
-- (Ascended/+7/2 Ascended gems) Hunter and Wuxia now land 950 vs 1,065
-- damage/hit (1.12x, down from 2.49x before this migration); at level 60,
-- 163 vs 211 (1.29x, down from 2.15x). Closing that last residual would
-- mean restricting gem bonuses to the gear-derived portion of attack only
-- (a formula change in useCombatStore.ts/resolve-combat/world-boss-attack,
-- not attempted here) -- flagged, not fixed.
--
-- Paired with MONSTER_MAGIC_DEFENSE_ANCHORS being fully recomputed off the
-- new numbers (combatResolver.ts, resolve-combat/index.ts mirror, and
-- zone_boss_magic_defense_base() SQL mirror below). Since gear now cancels
-- out of the anchor formula almost entirely, every anchor is now dominated
-- by the Spirit/Strength attribute gap -- verified by reproducing the exact
-- same anchor values from pure attribute math alone at several levels.
begin;

-- Backsword: physical_attack = magic_attack = Bow's own real curve at the
-- same required_level (15-130 copied directly; 1/5/10 computed from Bow's
-- own compounding formula).
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 6, 'magic_attack', 6) where item_family = 'backsword' and required_level = 1;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 6, 'magic_attack', 6) where item_family = 'backsword' and required_level = 5;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 7, 'magic_attack', 7) where item_family = 'backsword' and required_level = 10;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 8, 'magic_attack', 8) where item_family = 'backsword' and required_level = 15;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 9, 'magic_attack', 9) where item_family = 'backsword' and required_level = 20;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 11, 'magic_attack', 11) where item_family = 'backsword' and required_level = 25;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 12, 'magic_attack', 12) where item_family = 'backsword' and required_level = 30;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 14, 'magic_attack', 14) where item_family = 'backsword' and required_level = 35;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 16, 'magic_attack', 16) where item_family = 'backsword' and required_level = 40;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 18, 'magic_attack', 18) where item_family = 'backsword' and required_level = 45;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 20, 'magic_attack', 20) where item_family = 'backsword' and required_level = 50;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 23, 'magic_attack', 23) where item_family = 'backsword' and required_level = 55;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 26, 'magic_attack', 26) where item_family = 'backsword' and required_level = 60;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 30, 'magic_attack', 30) where item_family = 'backsword' and required_level = 65;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 34, 'magic_attack', 34) where item_family = 'backsword' and required_level = 70;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 38, 'magic_attack', 38) where item_family = 'backsword' and required_level = 75;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 44, 'magic_attack', 44) where item_family = 'backsword' and required_level = 80;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 50, 'magic_attack', 50) where item_family = 'backsword' and required_level = 85;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 56, 'magic_attack', 56) where item_family = 'backsword' and required_level = 90;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 64, 'magic_attack', 64) where item_family = 'backsword' and required_level = 95;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 73, 'magic_attack', 73) where item_family = 'backsword' and required_level = 100;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 83, 'magic_attack', 83) where item_family = 'backsword' and required_level = 105;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 94, 'magic_attack', 94) where item_family = 'backsword' and required_level = 110;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 107, 'magic_attack', 107) where item_family = 'backsword' and required_level = 115;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 121, 'magic_attack', 121) where item_family = 'backsword' and required_level = 120;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 124, 'magic_attack', 124) where item_family = 'backsword' and required_level = 121;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 127, 'magic_attack', 127) where item_family = 'backsword' and required_level = 122;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 131, 'magic_attack', 131) where item_family = 'backsword' and required_level = 123;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 134, 'magic_attack', 134) where item_family = 'backsword' and required_level = 124;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 137, 'magic_attack', 137) where item_family = 'backsword' and required_level = 125;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 141, 'magic_attack', 141) where item_family = 'backsword' and required_level = 126;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 145, 'magic_attack', 145) where item_family = 'backsword' and required_level = 127;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 148, 'magic_attack', 148) where item_family = 'backsword' and required_level = 128;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 152, 'magic_attack', 152) where item_family = 'backsword' and required_level = 129;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 156, 'magic_attack', 156) where item_family = 'backsword' and required_level = 130;

-- Bracelet: magic_attack = Ring's own compounding formula (2 * 1.03128^(level-1))
-- evaluated at Bracelet's own required_levels (no overlap with Ring's own).
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 3) where item_family = 'bracelet' and required_level = 15;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 4) where item_family = 'bracelet' and required_level = 25;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 6) where item_family = 'bracelet' and required_level = 35;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 8) where item_family = 'bracelet' and required_level = 45;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 11) where item_family = 'bracelet' and required_level = 55;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 14) where item_family = 'bracelet' and required_level = 65;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 20) where item_family = 'bracelet' and required_level = 75;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 27) where item_family = 'bracelet' and required_level = 85;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 36) where item_family = 'bracelet' and required_level = 95;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 49) where item_family = 'bracelet' and required_level = 105;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 67) where item_family = 'bracelet' and required_level = 115;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 71) where item_family = 'bracelet' and required_level = 117;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 83) where item_family = 'bracelet' and required_level = 122;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 97) where item_family = 'bracelet' and required_level = 127;

-- Zone Boss's own magic-defense mirror.
create or replace function public.zone_boss_magic_defense_base(p_level integer)
returns integer
language plpgsql
immutable
as $$
declare
  anchors integer[][] := array[
    array[1,3], array[5,17], array[10,32], array[15,58], array[20,86],
    array[25,118], array[30,146], array[35,178], array[40,207], array[45,233],
    array[50,256], array[55,283], array[60,309], array[65,333], array[70,358],
    array[75,388], array[80,419], array[85,448], array[90,476], array[95,506],
    array[100,537], array[105,561], array[110,584], array[115,608],
    array[120,631], array[125,655], array[130,684]
  ];
  v_level integer := least(greatest(p_level, anchors[1][1]), anchors[array_length(anchors,1)][1]);
  v_prev_level integer;
  v_prev_value integer;
  v_anchor_level integer;
  v_anchor_value integer;
  v_t numeric;
begin
  for i in 1..array_length(anchors,1) loop
    v_anchor_level := anchors[i][1];
    v_anchor_value := anchors[i][2];

    if v_level = v_anchor_level then
      return v_anchor_value;
    end if;

    if v_level < v_anchor_level then
      v_prev_level := anchors[i-1][1];
      v_prev_value := anchors[i-1][2];
      v_t := (v_level - v_prev_level)::numeric / (v_anchor_level - v_prev_level);
      return round(v_prev_value + (v_anchor_value - v_prev_value) * v_t);
    end if;
  end loop;

  return anchors[array_length(anchors,1)][2];
end;
$$;

-- One-time correction so any currently-active Zone Boss spawn picks up the
-- new baseline immediately.
update public.world_boss_spawns s
set
  magic_defense = case when cat.defense_profile = 'physical'
    then round(public.zone_boss_magic_defense_base(cat.zone_top_level) * 1.3)::integer
    else round(public.zone_boss_magic_defense_base(cat.zone_top_level) * 3.5)::integer
  end
from public.zone_boss_catalog() cat
where cat.boss_id = s.boss_id and s.status = 'active';

commit;
