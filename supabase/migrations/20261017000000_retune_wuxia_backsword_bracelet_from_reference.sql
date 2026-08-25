-- Re-tunes Backsword and Bracelet base_stats directly from real Conquer
-- Online reference data (reference/conquer-items/{backswords,bracelets}.md),
-- per the user's explicit request to compare against how physical weapons
-- (Bow/Sword/etc.) were built. Finding: no weapon in this game -- including
-- Bow -- stores a real per-item min/max; every weapon has always been one
-- flat physical_attack number, with display min/max synthesized at combat-
-- roll time from a single shared ratio (see combatResolver.ts's
-- DAMAGE_ROLL_MIN_RATIO/MAX_RATIO). Confirmed with the user: Backsword's new
-- physical_attack stays a single flat number too, no architecture change.
--
-- Backsword: physical_attack = round(avg(reference Max Atk, Min Atk)),
-- magic_attack = reference Magic Atk, both from the Normal-tier row per
-- level. The reference doc is missing levels 20/30/50/60 (noted in its own
-- header) -- both stats linearly interpolated between the neighboring known
-- levels for those four. Lucky Backsword (Lv1, no reference row -- it's this
-- game's own invented starter) scaled off the new Plum Backsword (Lv5)
-- numbers using the same ~0.4x ratio Fortune Blade used against Bronze
-- Blade (see 20261015000000_add_lucky_backsword.sql).
--
-- Bracelet: magic_attack = reference Magic Atk (Normal-tier row) directly --
-- the reference doc covers all 14 of this game's Bracelet levels exactly,
-- no gaps to interpolate. No physical_attack (Bracelet never had a physical
-- component, real or otherwise).
begin;

update public.item_templates as t
set base_stats = jsonb_build_object('physical_attack', v.physical, 'magic_attack', v.magic)
from (values
  (1, 2, 2),
  (5, 4, 4),
  (10, 7, 6),
  (15, 10, 11),
  (20, 13, 16),
  (25, 15, 20),
  (30, 19, 22),
  (35, 23, 24),
  (40, 27, 35),
  (45, 33, 46),
  (50, 43, 56),
  (55, 51, 66),
  (60, 65, 76),
  (65, 78, 86),
  (70, 92, 102),
  (75, 107, 122),
  (80, 125, 140),
  (85, 146, 162),
  (90, 170, 185),
  (95, 198, 215),
  (100, 230, 245),
  (105, 268, 283),
  (110, 311, 324),
  (115, 410, 408),
  (120, 440, 477),
  (121, 470, 546),
  (122, 500, 615),
  (123, 530, 684),
  (124, 560, 753),
  (125, 590, 822),
  (126, 620, 891),
  (127, 650, 960),
  (128, 680, 1029),
  (129, 710, 1098),
  (130, 740, 1167)
) as v(level, physical, magic)
where t.item_family = 'backsword' and t.required_level = v.level;

update public.item_templates as t
set base_stats = jsonb_build_object('magic_attack', v.magic)
from (values
  (15, 5),
  (25, 8),
  (35, 13),
  (45, 19),
  (55, 28),
  (65, 40),
  (75, 56),
  (85, 74),
  (95, 98),
  (105, 129),
  (115, 171),
  (117, 190),
  (122, 194),
  (127, 237)
) as v(level, magic)
where t.item_family = 'bracelet' and t.required_level = v.level;

commit;
