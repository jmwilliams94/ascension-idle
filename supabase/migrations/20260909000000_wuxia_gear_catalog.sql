-- First real gear catalog entry for Wuxia (Taoist), mirroring how Hunter's own
-- catalog was built (20260730000000_add_gear_catalog.sql) — original names,
-- stat numbers paced loosely off Conquer Online reference data in
-- reference/conquer-items/{backswords,caps,robes,bracelets,bags}.md, not
-- copied directly. All required_class = 'wuxia' (never null — Twin-soul and
-- Juggernaut still land in later migrations, Hunter must never see these).
--
-- Wuxia is the only one of the three new classes needing zero new plumbing —
-- weapon/hat/coat/ring/necklace all already exist as slot_types. Bracelet
-- fills the ring slot, Bag fills the necklace slot (per the user's mapping).
-- No boots — the existing shared boots catalog is reused as-is.
--
-- Per the user: only the weapon chain (Backsword) gets the fine per-level
-- 120-130 breakdown (mirroring Bow's own precedent); Cap/Robe/Bracelet/Bag
-- use coarser breakpoints instead (mirroring Hunter's own Ring/Necklace, not
-- Hunter's Hat/Coat, which did use the fine per-level pattern).
--
-- Backsword's magic_attack + dexterity curve intentionally reuses Bow's own
-- exact numbers (see 20260730000000_add_gear_catalog.sql +
-- 20260802020000_add_bow_ring_dexterity.sql) for cross-class balance parity
-- and because this is also the fix for the long-flagged "Wuxia has zero gear
-- boosting magic_attack" gap (CLAUDE.gear-and-forge.md). Cap/Robe/Bag reuse
-- Hunter's Necklace defense curve; Bracelet reuses Hunter's Ring
-- attack/dexterity curve. Robe additionally gets magic_defense = round(0.5 *
-- physical_defense), matching Coat's own precedent (Cap/Bag do not, matching
-- Hat/Necklace's own precedent of no magic_defense).

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values
  ('Willowfang Backsword', 'weapon', 'backsword', '{"magic_attack":7,"dexterity":1}'::jsonb, 8, 'wuxia'),
  ('Duskleaf Backsword', 'weapon', 'backsword', '{"magic_attack":10,"dexterity":2}'::jsonb, 15, 'wuxia'),
  ('Mistveil Backsword', 'weapon', 'backsword', '{"magic_attack":13,"dexterity":2}'::jsonb, 20, 'wuxia'),
  ('Ashwind Backsword', 'weapon', 'backsword', '{"magic_attack":17,"dexterity":3}'::jsonb, 25, 'wuxia'),
  ('Cinderleaf Backsword', 'weapon', 'backsword', '{"magic_attack":20,"dexterity":3}'::jsonb, 30, 'wuxia'),
  ('Hollowmoon Backsword', 'weapon', 'backsword', '{"magic_attack":24,"dexterity":4}'::jsonb, 35, 'wuxia'),
  ('Ravensong Backsword', 'weapon', 'backsword', '{"magic_attack":29,"dexterity":4}'::jsonb, 40, 'wuxia'),
  ('Wraithbloom Backsword', 'weapon', 'backsword', '{"magic_attack":33,"dexterity":5}'::jsonb, 45, 'wuxia'),
  ('Emberveil Backsword', 'weapon', 'backsword', '{"magic_attack":38,"dexterity":6}'::jsonb, 50, 'wuxia'),
  ('Shadowthorn Backsword', 'weapon', 'backsword', '{"magic_attack":43,"dexterity":6}'::jsonb, 55, 'wuxia'),
  ('Nightlotus Backsword', 'weapon', 'backsword', '{"magic_attack":49,"dexterity":7}'::jsonb, 60, 'wuxia'),
  ('Frostwhisper Backsword', 'weapon', 'backsword', '{"magic_attack":54,"dexterity":8}'::jsonb, 65, 'wuxia'),
  ('Stormsoul Backsword', 'weapon', 'backsword', '{"magic_attack":60,"dexterity":9}'::jsonb, 70, 'wuxia'),
  ('Ironsage Backsword', 'weapon', 'backsword', '{"magic_attack":67,"dexterity":10}'::jsonb, 75, 'wuxia'),
  ('Moonfang Backsword', 'weapon', 'backsword', '{"magic_attack":73,"dexterity":11}'::jsonb, 80, 'wuxia'),
  ('Duskbane Backsword', 'weapon', 'backsword', '{"magic_attack":80,"dexterity":12}'::jsonb, 85, 'wuxia'),
  ('Spiritedge Backsword', 'weapon', 'backsword', '{"magic_attack":88,"dexterity":13}'::jsonb, 90, 'wuxia'),
  ('Hallowmark Backsword', 'weapon', 'backsword', '{"magic_attack":95,"dexterity":14}'::jsonb, 95, 'wuxia'),
  ('Voidsong Backsword', 'weapon', 'backsword', '{"magic_attack":103,"dexterity":15}'::jsonb, 100, 'wuxia'),
  ('Starlit Backsword', 'weapon', 'backsword', '{"magic_attack":111,"dexterity":17}'::jsonb, 105, 'wuxia'),
  ('Nethermoon Backsword', 'weapon', 'backsword', '{"magic_attack":120,"dexterity":18}'::jsonb, 110, 'wuxia'),
  ('Skyrend Backsword', 'weapon', 'backsword', '{"magic_attack":128,"dexterity":19}'::jsonb, 115, 'wuxia'),
  ('Astral Backsword', 'weapon', 'backsword', '{"magic_attack":137,"dexterity":21}'::jsonb, 120, 'wuxia'),
  ('Astral Backsword', 'weapon', 'backsword', '{"magic_attack":139,"dexterity":21}'::jsonb, 121, 'wuxia'),
  ('Astral Backsword', 'weapon', 'backsword', '{"magic_attack":141,"dexterity":21}'::jsonb, 122, 'wuxia'),
  ('Astral Backsword', 'weapon', 'backsword', '{"magic_attack":143,"dexterity":21}'::jsonb, 123, 'wuxia'),
  ('Astral Backsword', 'weapon', 'backsword', '{"magic_attack":145,"dexterity":22}'::jsonb, 124, 'wuxia'),
  ('Celestial Backsword', 'weapon', 'backsword', '{"magic_attack":147,"dexterity":22}'::jsonb, 125, 'wuxia'),
  ('Celestial Backsword', 'weapon', 'backsword', '{"magic_attack":149,"dexterity":22}'::jsonb, 126, 'wuxia'),
  ('Celestial Backsword', 'weapon', 'backsword', '{"magic_attack":151,"dexterity":23}'::jsonb, 127, 'wuxia'),
  ('Celestial Backsword', 'weapon', 'backsword', '{"magic_attack":153,"dexterity":23}'::jsonb, 128, 'wuxia'),
  ('Celestial Backsword', 'weapon', 'backsword', '{"magic_attack":154,"dexterity":23}'::jsonb, 129, 'wuxia'),
  ('Eternity Backsword', 'weapon', 'backsword', '{"magic_attack":156,"dexterity":23}'::jsonb, 130, 'wuxia'),

  ('Reed Cap', 'hat', 'cap', '{"physical_defense":3}'::jsonb, 7, 'wuxia'),
  ('Silkleaf Cap', 'hat', 'cap', '{"physical_defense":7}'::jsonb, 17, 'wuxia'),
  ('Dawnmist Cap', 'hat', 'cap', '{"physical_defense":11}'::jsonb, 27, 'wuxia'),
  ('Willowveil Cap', 'hat', 'cap', '{"physical_defense":15}'::jsonb, 37, 'wuxia'),
  ('Cranewing Cap', 'hat', 'cap', '{"physical_defense":19}'::jsonb, 45, 'wuxia'),
  ('Duskweave Cap', 'hat', 'cap', '{"physical_defense":22}'::jsonb, 52, 'wuxia'),
  ('Moonpetal Cap', 'hat', 'cap', '{"physical_defense":30}'::jsonb, 67, 'wuxia'),
  ('Emberlotus Cap', 'hat', 'cap', '{"physical_defense":39}'::jsonb, 82, 'wuxia'),
  ('Frostsong Cap', 'hat', 'cap', '{"physical_defense":49}'::jsonb, 97, 'wuxia'),
  ('Starweave Cap', 'hat', 'cap', '{"physical_defense":60}'::jsonb, 112, 'wuxia'),
  ('Astral Cap', 'hat', 'cap', '{"physical_defense":66}'::jsonb, 120, 'wuxia'),
  ('Celestial Cap', 'hat', 'cap', '{"physical_defense":70}'::jsonb, 125, 'wuxia'),
  ('Eternity Cap', 'hat', 'cap', '{"physical_defense":74}'::jsonb, 130, 'wuxia'),

  ('Hemp Robe', 'coat', 'robe', '{"physical_defense":3,"magic_defense":2}'::jsonb, 7, 'wuxia'),
  ('Sable Robe', 'coat', 'robe', '{"physical_defense":7,"magic_defense":4}'::jsonb, 17, 'wuxia'),
  ('Bramblesilk Robe', 'coat', 'robe', '{"physical_defense":11,"magic_defense":6}'::jsonb, 27, 'wuxia'),
  ('Ashwoven Robe', 'coat', 'robe', '{"physical_defense":15,"magic_defense":8}'::jsonb, 37, 'wuxia'),
  ('Cloudspun Robe', 'coat', 'robe', '{"physical_defense":19,"magic_defense":10}'::jsonb, 45, 'wuxia'),
  ('Duskbound Robe', 'coat', 'robe', '{"physical_defense":22,"magic_defense":11}'::jsonb, 52, 'wuxia'),
  ('Jadefall Robe', 'coat', 'robe', '{"physical_defense":30,"magic_defense":15}'::jsonb, 67, 'wuxia'),
  ('Wraithsilk Robe', 'coat', 'robe', '{"physical_defense":39,"magic_defense":20}'::jsonb, 82, 'wuxia'),
  ('Phoenixdown Robe', 'coat', 'robe', '{"physical_defense":49,"magic_defense":25}'::jsonb, 97, 'wuxia'),
  ('Stormveil Robe', 'coat', 'robe', '{"physical_defense":60,"magic_defense":30}'::jsonb, 112, 'wuxia'),
  ('Astral Robe', 'coat', 'robe', '{"physical_defense":66,"magic_defense":33}'::jsonb, 120, 'wuxia'),
  ('Celestial Robe', 'coat', 'robe', '{"physical_defense":70,"magic_defense":35}'::jsonb, 125, 'wuxia'),
  ('Eternity Robe', 'coat', 'robe', '{"physical_defense":74,"magic_defense":37}'::jsonb, 130, 'wuxia'),

  ('Twine Bracelet', 'ring', 'bracelet', '{"physical_attack":2,"dexterity":1}'::jsonb, 1, 'wuxia'),
  ('Copper Bracelet', 'ring', 'bracelet', '{"physical_attack":6,"dexterity":1}'::jsonb, 10, 'wuxia'),
  ('Beaded Bracelet', 'ring', 'bracelet', '{"physical_attack":10,"dexterity":2}'::jsonb, 20, 'wuxia'),
  ('Jasper Bracelet', 'ring', 'bracelet', '{"physical_attack":15,"dexterity":2}'::jsonb, 30, 'wuxia'),
  ('Coral Bracelet', 'ring', 'bracelet', '{"physical_attack":21,"dexterity":3}'::jsonb, 40, 'wuxia'),
  ('Onyx Bracelet', 'ring', 'bracelet', '{"physical_attack":27,"dexterity":4}'::jsonb, 50, 'wuxia'),
  ('Amberwood Bracelet', 'ring', 'bracelet', '{"physical_attack":34,"dexterity":5}'::jsonb, 60, 'wuxia'),
  ('Serpentine Bracelet', 'ring', 'bracelet', '{"physical_attack":41,"dexterity":6}'::jsonb, 70, 'wuxia'),
  ('Moonstone Bracelet', 'ring', 'bracelet', '{"physical_attack":49,"dexterity":7}'::jsonb, 80, 'wuxia'),
  ('Bloodgarnet Bracelet', 'ring', 'bracelet', '{"physical_attack":58,"dexterity":9}'::jsonb, 90, 'wuxia'),
  ('Duskcrystal Bracelet', 'ring', 'bracelet', '{"physical_attack":67,"dexterity":10}'::jsonb, 100, 'wuxia'),
  ('Voidglass Bracelet', 'ring', 'bracelet', '{"physical_attack":77,"dexterity":12}'::jsonb, 110, 'wuxia'),
  ('Starforged Bracelet', 'ring', 'bracelet', '{"physical_attack":83,"dexterity":12}'::jsonb, 116, 'wuxia'),
  ('Astral Bracelet', 'ring', 'bracelet', '{"physical_attack":88,"dexterity":13}'::jsonb, 121, 'wuxia'),
  ('Celestial Bracelet', 'ring', 'bracelet', '{"physical_attack":94,"dexterity":14}'::jsonb, 126, 'wuxia'),

  ('Cotton Bag', 'necklace', 'bag', '{"physical_defense":3}'::jsonb, 7, 'wuxia'),
  ('Woven Bag', 'necklace', 'bag', '{"physical_defense":7}'::jsonb, 17, 'wuxia'),
  ('Tassel Bag', 'necklace', 'bag', '{"physical_defense":11}'::jsonb, 27, 'wuxia'),
  ('Silkcord Bag', 'necklace', 'bag', '{"physical_defense":15}'::jsonb, 37, 'wuxia'),
  ('Mistpouch Bag', 'necklace', 'bag', '{"physical_defense":19}'::jsonb, 45, 'wuxia'),
  ('Duskcloth Bag', 'necklace', 'bag', '{"physical_defense":22}'::jsonb, 52, 'wuxia'),
  ('Jaderope Bag', 'necklace', 'bag', '{"physical_defense":30}'::jsonb, 67, 'wuxia'),
  ('Wraithsatchel Bag', 'necklace', 'bag', '{"physical_defense":39}'::jsonb, 82, 'wuxia'),
  ('Phoenixplume Bag', 'necklace', 'bag', '{"physical_defense":49}'::jsonb, 97, 'wuxia'),
  ('Stormsilk Bag', 'necklace', 'bag', '{"physical_defense":60}'::jsonb, 112, 'wuxia'),
  ('Astral Bag', 'necklace', 'bag', '{"physical_defense":66}'::jsonb, 120, 'wuxia'),
  ('Celestial Bag', 'necklace', 'bag', '{"physical_defense":70}'::jsonb, 125, 'wuxia'),
  ('Eternity Bag', 'necklace', 'bag', '{"physical_defense":74}'::jsonb, 130, 'wuxia');
