-- Bows and Rings were also missing a stat the real reference data has --
-- caught the same way Coats' Magic Defense gap was (reference/conquer-items/
-- bows.md and rings.md, local-only). Both carry a "Dex" column alongside
-- their Max/Min Atk -- our catalog only ever captured the attack stat.
--
-- Unlike Coats' magic_defense, this one is wired to be genuinely functional
-- immediately: it's stored under the existing `dodge` base_stats key, the
-- same one Boots already use, so computeEquipmentBonus's generic per-slot
-- summation (equipmentBonus.ts) picks it up with zero extra code -- it
-- stacks straight into the player's real dodge stat (already live in
-- combat via combatResolver.ts's rollIsHit). This is the confirmed mapping
-- for "Dex" in this game: CLAUDE.md's Combat section already establishes
-- "Agility governs accuracy/dodge, not damage" as the design direction, and
-- there's no separate accuracy-vs-monster-evasion mechanic to feed instead
-- (monsters have no evasion stat -- see the Combat section's one-directional
-- dodge note).
--
-- Not a literal copy of the source's own Dex numbers -- same "study the
-- reference for pacing, invent our own values" methodology as every other
-- stat in this catalog. The source's Dex column doesn't scale proportionally
-- with its own Max/Min Atk column at all (it's a much flatter, banded
-- progression -- e.g. Bamboo Bow's Dex 13 vs. Hunting Bow's Dex 12 despite a
-- 5x jump in Max Atk between them), so rather than trying to hand-copy that
-- oddly-shaped curve, our own values are simply round(physical_attack *
-- 0.15), floored at 1 -- a smooth, modest secondary stat that scales with
-- each item's own already-designed attack progression instead.
begin;

-- Bows (item_family = bow)
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 1) where item_family = 'bow' and name = 'Sapling Bow' and required_level = 8;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 2) where item_family = 'bow' and name = 'Ranger''s Bow' and required_level = 15;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 2) where item_family = 'bow' and name = 'Thornwood Bow' and required_level = 20;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 3) where item_family = 'bow' and name = 'Evergreen Bow' and required_level = 25;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 3) where item_family = 'bow' and name = 'Stonewood Bow' and required_level = 30;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 4) where item_family = 'bow' and name = 'Gale Bow' and required_level = 35;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 4) where item_family = 'bow' and name = 'Vermil Bow' and required_level = 40;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 5) where item_family = 'bow' and name = 'Ram''s Horn Bow' and required_level = 45;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 6) where item_family = 'bow' and name = 'Sovereign Bow' and required_level = 50;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 6) where item_family = 'bow' and name = 'Farreach Bow' and required_level = 55;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 7) where item_family = 'bow' and name = 'Drover''s Bow' and required_level = 60;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 8) where item_family = 'bow' and name = 'Forgesteel Bow' and required_level = 65;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 9) where item_family = 'bow' and name = 'Windwing Bow' and required_level = 70;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 10) where item_family = 'bow' and name = 'Stripeback Bow' and required_level = 75;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 11) where item_family = 'bow' and name = 'Heartwood Bow' and required_level = 80;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 12) where item_family = 'bow' and name = 'Runed Bow' and required_level = 85;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 13) where item_family = 'bow' and name = 'Starfall Bow' and required_level = 90;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 14) where item_family = 'bow' and name = 'Nightglow Bow' and required_level = 95;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 15) where item_family = 'bow' and name = 'Rosemark Bow' and required_level = 100;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 17) where item_family = 'bow' and name = 'Wyrmstring Bow' and required_level = 105;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 18) where item_family = 'bow' and name = 'Timeworn Bow' and required_level = 110;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 19) where item_family = 'bow' and name = 'Skyborne Bow' and required_level = 115;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 21) where item_family = 'bow' and name = 'Sorcerous Bow' and required_level = 120;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 21) where item_family = 'bow' and name = 'Sorcerous Bow' and required_level = 121;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 21) where item_family = 'bow' and name = 'Sorcerous Bow' and required_level = 122;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 21) where item_family = 'bow' and name = 'Sorcerous Bow' and required_level = 123;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 22) where item_family = 'bow' and name = 'Sorcerous Bow' and required_level = 124;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 22) where item_family = 'bow' and name = 'Emberwing Bow' and required_level = 125;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 22) where item_family = 'bow' and name = 'Emberwing Bow' and required_level = 126;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 23) where item_family = 'bow' and name = 'Emberwing Bow' and required_level = 127;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 23) where item_family = 'bow' and name = 'Emberwing Bow' and required_level = 128;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 23) where item_family = 'bow' and name = 'Emberwing Bow' and required_level = 129;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 23) where item_family = 'bow' and name = 'Voidcaller Bow' and required_level = 130;

-- Lucky Bow (item_family = lucky-bow, standalone starter item) -- same
-- formula applied for consistency even though it's excluded from the real
-- Bow chain's Level Upgrade progression.
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 1) where item_family = 'lucky-bow' and name = 'Lucky Bow';

-- Rings (item_family = ring)
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 1) where item_family = 'ring' and name = 'Tin Ring' and required_level = 1;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 1) where item_family = 'ring' and name = 'Brass Ring' and required_level = 10;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 2) where item_family = 'ring' and name = 'Pewter Ring' and required_level = 20;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 2) where item_family = 'ring' and name = 'Gilded Ring' and required_level = 30;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 3) where item_family = 'ring' and name = 'Violet Ring' and required_level = 40;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 4) where item_family = 'ring' and name = 'Bonewhite Ring' and required_level = 50;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 5) where item_family = 'ring' and name = 'Verdant Ring' and required_level = 60;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 6) where item_family = 'ring' and name = 'Opal Ring' and required_level = 70;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 7) where item_family = 'ring' and name = 'Banded Ring' and required_level = 80;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 9) where item_family = 'ring' and name = 'Glass Ring' and required_level = 90;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 10) where item_family = 'ring' and name = 'Facet Ring' and required_level = 100;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 12) where item_family = 'ring' and name = 'Wyrmscale Ring' and required_level = 110;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 12) where item_family = 'ring' and name = 'Weeping Ring' and required_level = 116;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 13) where item_family = 'ring' and name = 'Oathbound Ring' and required_level = 121;
update public.item_templates set base_stats = base_stats || jsonb_build_object('dodge', 14) where item_family = 'ring' and name = 'Stormcaller Ring' and required_level = 126;

commit;
