-- Full economy rescale (requested by the user, 2026-08-29) — supersedes the
-- old per-item-name price list in 20260730010000_add_item_prices.sql, which
-- only ever covered the Hunter Bow/Ring/Necklace/Boots/Hat/Coat lines (every
-- other class's gear defaulted to price = 0). Replaced with a single
-- formula per slot_type, applied to every item_templates row regardless of
-- class/item_family/name, so Wuxia/Twin-soul/Juggernaut gear gets priced too.
--
-- price is both the Shop buy price and the input to sell_item's
-- `price * 0.5 * qualityMultiplier` formula (now also durability-scaled, see
-- 20261110010000) — so `price = 2 * targetSellPrice` at Normal quality/full
-- durability, preserving the existing 50% vendor cut instead of redesigning
-- it. Target sell prices (confirmed with the user): weapons 100 -> 25,000
-- across levels 1-130; armor shares a common low anchor (~250-500 sell,
-- i.e. 750 buy, flat at/below level 10) but diverges by slot at level 130 —
-- Chest 75,000 / Head 48,750 (65%) / Ring 30,000 (40%) / Necklace 18,750
-- (25%) / Boots 9,000 (12%), the "steep drop-off" ratio the user picked.
--
-- Quiver/money-bag/gem-bag/promotion-gear/promotion-material/material/
-- pickaxe/ore are left untouched (not gear, no sell-value ask here).

update public.item_templates
set price = round(200 * power(250, (required_level - 1) / 129.0))
where slot_type = 'weapon';

update public.item_templates
set price = round(750 * power(200, greatest(0, least(1, (required_level - 10) / 120.0))))
where slot_type = 'coat';

update public.item_templates
set price = round(750 * power(130, greatest(0, least(1, (required_level - 10) / 120.0))))
where slot_type = 'hat';

update public.item_templates
set price = round(750 * power(80, greatest(0, least(1, (required_level - 10) / 120.0))))
where slot_type = 'ring';

update public.item_templates
set price = round(750 * power(50, greatest(0, least(1, (required_level - 10) / 120.0))))
where slot_type = 'necklace';

update public.item_templates
set price = round(750 * power(24, greatest(0, least(1, (required_level - 10) / 120.0))))
where slot_type = 'boots';
