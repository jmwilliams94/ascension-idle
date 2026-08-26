-- Fixes a real cross-class leak, not just a display nuisance: Hunter's
-- original Bow/Ring/Necklace catalogs predate the multi-class system and
-- were never backfilled with required_class (left null). Every consumer of
-- the "required_class is null or required_class = classId" pattern
-- (ShopPanel.tsx's availableToClass, useInventoryStore.ts's
-- pickLevelAppropriateTemplate, BankSquares.tsx's withdraw-family filter,
-- and this same check server-side in pick_drop_template) treats null as
-- "visible/droppable to every class" — so a Wuxia (or any non-Hunter class)
-- could see Hunter's Bow/Ring/Necklace in their Shop AND actually receive
-- them as real kill-drops. This exact gotcha was already found and worked
-- around once, locally, in equipmentBonus.ts's getMaxLevelPlaceholderIconSrc
-- (2026-08-26) — this migration fixes it at the source instead, so every
-- other call site (including the ones that were never patched) is correct
-- automatically, with no code changes needed anywhere.
--
-- Deliberately NOT touched: Boots (`boots` family, still null) — genuinely
-- shared across every class, no class has its own catalog. Wooden Sword
-- (`sword` family) and the Mining Pickaxe (`pickaxe` family) — both
-- intentional class-agnostic fallbacks, already excluded from kill-drops via
-- NON_DROPPABLE_FAMILIES. Lucky Bow (`lucky-bow`) is already correctly
-- tagged 'hunter'.
begin;

update public.item_templates
set required_class = 'hunter'
where item_family in ('bow', 'ring', 'necklace')
  and required_class is null;

commit;
