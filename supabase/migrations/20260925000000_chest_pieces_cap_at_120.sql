-- Per the user: the three "chest piece" (coat-slot) catalogs for the new
-- classes -- Robe (Wuxia), Mail (Twin-soul, displays as "X Armor"), Armor
-- (Juggernaut) -- should stop at level 120 instead of continuing through
-- the same 121/126 fine-ascension tiers every other new-class gear chain
-- uses. This is a deliberate design choice, not a reference-data
-- correction, and only touches these three coat-slot families -- hat/
-- weapon/ring/necklace/off-hand chains (cap, coronet, helmet, shield,
-- bracelet, bag, and all five weapon chains) are unaffected and keep their
-- existing 121/126 tiers.
--
-- Safe as a straight delete: character creation only allows Hunter today
-- (Twin-soul/Wuxia/Juggernaut are locked), so no live character can hold,
-- have equipped, or have listed/mailed any of these rows.

begin;

  delete from public.item_templates
  where item_family in ('robe', 'mail', 'armor')
    and required_level in (121, 126);

commit;
