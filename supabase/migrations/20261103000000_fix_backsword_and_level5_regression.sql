-- Fixes two regressions introduced by 20261101000000_recompound_weapon_curves.sql:
--
-- 1. Backsword was incorrectly touched at all. Its migration assumed
--    Backsword was still ratio-derived off Bow (x0.3213, the ORIGINAL
--    20260913 rescale value) -- but 20261017000000_retune_wuxia_backsword_
--    bracelet_from_reference.sql already fully superseded that: Backsword's
--    physical_attack/magic_attack are independently sourced straight from
--    reference/conquer-items/backswords.md, not derived from Bow's curve at
--    all. Worse, that migration's `jsonb_build_object('physical_attack',
--    ..., 'magic_attack', ...)` deliberately has NO dexterity key (real
--    Backswords have no Dexterity), but 20261101000000's jsonb_set added
--    one anyway. This restores every required_level 20261101000000 actually
--    matched (15 through 130 -- required_level=8 never existed for
--    Backsword post-20260916000000's level-5/10 restructuring, so that part
--    was a harmless no-op) back to the exact 20261017000000 reference
--    values, with base_stats fully replaced (no dexterity key), matching
--    that migration's own approach exactly.
--
-- 2. The 6 ratio-derived families that share Bow's level-5/10 restructuring
--    (club-twinsoul/juggernaut, longsword-twinsoul/juggernaut, blade-
--    twinsoul/juggernaut) never got their required_level=5 row touched --
--    20261101000000 only iterated Bow's own breakpoints (8, 15, 20, ...),
--    which no longer includes 5 for these families (added later by
--    20260916000000_add_weapon_level_5_10.sql, a level Bow itself never
--    had). required_level=10 needed no fix (it's the old level-8 row,
--    renumbered but stat-unchanged per 20260916's own "stats already sat
--    correctly" note -- and since the new curve is pinned to Bow's
--    level-8 value exactly, that old value is still correct as-is). Level 5
--    is computed the same way 20260916000000 itself did: extrapolate the
--    new compounding Bow curve one step below its own level-8 anchor
--    (7 / 1.02577^3 ≈ 6.49 -> 6), then apply each family's preserved ratio.
begin;

-- Backsword: restore real reference-sourced values (20261017000000), no dexterity key
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 15, 'magic_attack', 20) where item_family = 'backsword' and required_level = 25;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 10, 'magic_attack', 11) where item_family = 'backsword' and required_level = 15;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 13, 'magic_attack', 16) where item_family = 'backsword' and required_level = 20;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 19, 'magic_attack', 22) where item_family = 'backsword' and required_level = 30;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 23, 'magic_attack', 24) where item_family = 'backsword' and required_level = 35;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 27, 'magic_attack', 35) where item_family = 'backsword' and required_level = 40;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 33, 'magic_attack', 46) where item_family = 'backsword' and required_level = 45;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 43, 'magic_attack', 56) where item_family = 'backsword' and required_level = 50;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 51, 'magic_attack', 66) where item_family = 'backsword' and required_level = 55;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 65, 'magic_attack', 76) where item_family = 'backsword' and required_level = 60;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 78, 'magic_attack', 86) where item_family = 'backsword' and required_level = 65;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 92, 'magic_attack', 102) where item_family = 'backsword' and required_level = 70;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 107, 'magic_attack', 122) where item_family = 'backsword' and required_level = 75;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 125, 'magic_attack', 140) where item_family = 'backsword' and required_level = 80;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 146, 'magic_attack', 162) where item_family = 'backsword' and required_level = 85;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 170, 'magic_attack', 185) where item_family = 'backsword' and required_level = 90;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 198, 'magic_attack', 215) where item_family = 'backsword' and required_level = 95;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 230, 'magic_attack', 245) where item_family = 'backsword' and required_level = 100;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 268, 'magic_attack', 283) where item_family = 'backsword' and required_level = 105;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 311, 'magic_attack', 324) where item_family = 'backsword' and required_level = 110;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 410, 'magic_attack', 408) where item_family = 'backsword' and required_level = 115;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 440, 'magic_attack', 477) where item_family = 'backsword' and required_level = 120;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 470, 'magic_attack', 546) where item_family = 'backsword' and required_level = 121;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 500, 'magic_attack', 615) where item_family = 'backsword' and required_level = 122;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 530, 'magic_attack', 684) where item_family = 'backsword' and required_level = 123;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 560, 'magic_attack', 753) where item_family = 'backsword' and required_level = 124;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 590, 'magic_attack', 822) where item_family = 'backsword' and required_level = 125;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 620, 'magic_attack', 891) where item_family = 'backsword' and required_level = 126;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 650, 'magic_attack', 960) where item_family = 'backsword' and required_level = 127;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 680, 'magic_attack', 1029) where item_family = 'backsword' and required_level = 128;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 710, 'magic_attack', 1098) where item_family = 'backsword' and required_level = 129;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 740, 'magic_attack', 1167) where item_family = 'backsword' and required_level = 130;

-- Level-5 rows for the 6 Bow-ratio-derived families (new Bow(5) extrapolated = 6)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'club-twinsoul' and required_level = 5;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'club-juggernaut' and required_level = 5;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '5'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 5;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '5'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 5;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-twinsoul' and required_level = 5;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-juggernaut' and required_level = 5;

commit;
