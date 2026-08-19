-- Renames every Club/Sword/Blade/Wand(prev. Maul)/Backsword item to a
-- Conquer-Online-derived synonym name, per the full naming pass worked out
-- in conversation (mirrors reference/conquer-items/{clubs,swords,blades,
-- wands,backswords}.md level-for-level, then swaps each real Conquer name
-- for an adjacent synonym -- the same "Eagle Hat -> Talon Hat" method
-- already used for Hunter gear -- rather than the placeholder Rustcut/
-- Ironbound/etc names reused verbatim across every new-class family since
-- the original catalogs). Also renames the 'greatmaul' item_family to
-- 'wand' (its display name is becoming "X Wand" this pass, so the internal
-- key now matches -- Juggernaut's own weapon was always a reflavored Wand
-- per 20260912000000_juggernaut_gear_catalog.sql's own note). Backsword's
-- source data (reference/conquer-items/backswords.md) is missing levels 20,
-- 30, 50 and 60 -- those four get an invented name fitting the surrounding
-- material/theme instead of a Conquer-derived one. A new Level 1 Blade item
-- (Fortune Blade) is also added, mirroring the source data's one-off "Lucky
-- Sword" -- Blade is the only weapon category with a sub-5 starter tier, so
-- no other family gets a level 1 row.
--
-- Club/Sword/Blade renames apply identically across the Juggernaut/
-- Twin-soul chains and Twin-soul's offhand mirrors (same conceptual item,
-- 3 independently-gated rows -- see the original catalogs' own reasoning
-- for why they're split, and 20260913000000_rescale_weapon_curves.sql for
-- why the offhand mirrors exist).
begin;

-- Club
update public.item_templates set name = case
  when required_level = 5 then 'Knot Club'
  when required_level = 10 then 'Rustcut Club'
  when required_level = 15 then 'Stub Club'
  when required_level = 20 then 'Cudgel Club'
  when required_level = 25 then 'Hardwood Club'
  when required_level = 30 then 'Mastiff Club'
  when required_level = 35 then 'Cane Club'
  when required_level = 40 then 'Anvil Club'
  when required_level = 45 then 'Legion Club'
  when required_level = 50 then 'Siege Club'
  when required_level = 55 then 'Skirmish Club'
  when required_level = 60 then 'Fang Club'
  when required_level = 65 then 'Stinger Club'
  when required_level = 70 then 'Copper Club'
  when required_level = 75 then 'Steel Club'
  when required_level = 80 then 'Claw Club'
  when required_level = 85 then 'Panther Club'
  when required_level = 90 then 'Bone Club'
  when required_level = 95 then 'Fin Club'
  when required_level = 100 then 'Serpent Club'
  when required_level = 105 then 'Wyrm Club'
  when required_level = 110 then 'Triumph Club'
  when required_level = 115 then 'Titan Club'
  when required_level between 120 and 124 then 'Storm Club'
  when required_level between 125 and 129 then 'Ruin Club'
  when required_level = 130 then 'Crown Club'
  else name end
where item_family in ('club-juggernaut', 'club-twinsoul', 'club-offhand-twinsoul');

-- Sword
update public.item_templates set name = case
  when required_level = 5 then 'Squire Sword'
  when required_level = 10 then 'Coil Sword'
  when required_level = 15 then 'Shade Sword'
  when required_level = 20 then 'Gleam Sword'
  when required_level = 25 then 'Quartz Sword'
  when required_level = 30 then 'Cinder Sword'
  when required_level = 35 then 'Obsidian Sword'
  when required_level = 40 then 'Ridge Sword'
  when required_level = 45 then 'Calm Sword'
  when required_level = 50 then 'Tusk Sword'
  when required_level = 55 then 'Glass Sword'
  when required_level = 60 then 'Flamberge'
  when required_level = 65 then 'Rover Sword'
  when required_level = 70 then 'Marlin Sword'
  when required_level = 75 then 'Radiant Sword'
  when required_level = 80 then 'Dual Sword'
  when required_level = 85 then 'Prism Sword'
  when required_level = 90 then 'Great Sword'
  when required_level = 95 then 'Wyrm Sword'
  when required_level = 100 then 'Vow Sword'
  when required_level = 105 then 'Soar Sword'
  when required_level = 110 then 'Clear Sword'
  when required_level = 115 then 'Abyss Sword'
  when required_level between 120 and 124 then 'Regal Sword'
  when required_level between 125 and 129 then 'Ruin Sword'
  when required_level = 130 then 'Crown Sword'
  else name end
where item_family in ('longsword-juggernaut', 'longsword-twinsoul', 'longsword-offhand-twinsoul');

-- Blade (including the new Level 1 Fortune Blade, inserted below)
update public.item_templates set name = case
  when required_level = 5 then 'Bronze Blade'
  when required_level = 10 then 'Vine Blade'
  when required_level = 15 then 'Fiend Blade'
  when required_level = 20 then 'Glint Blade'
  when required_level = 25 then 'Scimitar'
  when required_level = 30 then 'Wide Blade'
  when required_level = 35 then 'Warped Blade'
  when required_level = 40 then 'Saber'
  when required_level = 45 then 'Garnet Blade'
  when required_level = 50 then 'Crescent Blade'
  when required_level = 55 then 'Chill Blade'
  when required_level = 60 then 'Khopesh'
  when required_level = 65 then 'Stag Blade'
  when required_level = 70 then 'Wren Blade'
  when required_level = 75 then 'Wyvern Blade'
  when required_level = 80 then 'Hefty Blade'
  when required_level = 85 then 'Kilij'
  when required_level = 90 then 'Divine Blade'
  when required_level = 95 then 'Keen Blade'
  when required_level = 100 then 'Prism Blade'
  when required_level = 105 then 'Solar Blade'
  when required_level = 110 then 'Legend Blade'
  when required_level = 115 then 'Triumph Blade'
  when required_level between 120 and 124 then 'Rime Blade'
  when required_level between 125 and 129 then 'Blaze Blade'
  when required_level = 130 then 'Grave Blade'
  else name end
where item_family in ('blade-juggernaut', 'blade-twinsoul', 'blade-offhand-twinsoul');

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values
  ('Fortune Blade', 'weapon', 'blade-juggernaut', '{"physical_attack":2,"dexterity":1}'::jsonb, 1, 'juggernaut'),
  ('Fortune Blade', 'weapon', 'blade-twinsoul', '{"physical_attack":2,"dexterity":1}'::jsonb, 1, 'twin-soul'),
  ('Fortune Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":2,"dexterity":1}'::jsonb, 1, 'twin-soul');

-- Wand (previously named/keyed as 'greatmaul' -- Juggernaut's own exclusive
-- two-hander, reflavored from the source data's caster Wand into a heavy
-- blunt weapon; this pass renames the family key to match its display name)
update public.item_templates set item_family = 'wand' where item_family = 'greatmaul';

update public.item_templates set name = case
  when required_level = 5 then 'Pebble Wand'
  when required_level = 10 then 'Stone Wand'
  when required_level = 15 then 'Heartwood Wand'
  when required_level = 20 then 'Clash Wand'
  when required_level = 25 then 'Despot Wand'
  when required_level = 30 then 'Temple Wand'
  when required_level = 35 then 'Legion Wand'
  when required_level = 40 then 'Lion Wand'
  when required_level = 45 then 'Epoch Wand'
  when required_level = 50 then 'Sacred Wand'
  when required_level = 55 then 'Bloom Wand'
  when required_level = 60 then 'Strife Wand'
  when required_level = 65 then 'Truce Wand'
  when required_level = 70 then 'Forge Wand'
  when required_level = 75 then 'Alloy Wand'
  when required_level = 80 then 'Summit Wand'
  when required_level = 85 then 'Wolf Wand'
  when required_level = 90 then 'Purge Wand'
  when required_level = 95 then 'Stalwart Wand'
  when required_level = 100 then 'Bronze Wand'
  when required_level = 105 then 'Platinum Wand'
  when required_level = 110 then 'Drake Wand'
  when required_level = 115 then 'Victory Wand'
  when required_level between 120 and 124 then 'Warlord Wand'
  when required_level between 125 and 129 then 'Overlord Wand'
  when required_level = 130 then 'Crown Wand'
  else name end
where item_family = 'wand';

-- Backsword (Wuxia's own weapon; top 3 tiers keep the Astral/Celestial/
-- Eternity naming per the user -- fits the class's mystic theme, unlike
-- the other weapon chains which get their own bespoke top-tier names)
update public.item_templates set name = case
  when required_level = 5 then 'Plum Backsword'
  when required_level = 10 then 'Charm Backsword'
  when required_level = 15 then 'Honest Backsword'
  when required_level = 20 then 'Willow Backsword'
  when required_level = 25 then 'Moonlit Backsword'
  when required_level = 30 then 'Petal Backsword'
  when required_level = 35 then 'Silk Backsword'
  when required_level = 40 then 'Twilight Backsword'
  when required_level = 45 then 'Steel Backsword'
  when required_level = 50 then 'Bronze Backsword'
  when required_level = 55 then 'Amber Backsword'
  when required_level = 60 then 'Jade Backsword'
  when required_level = 65 then 'Comet Backsword'
  when required_level = 70 then 'Noble Backsword'
  when required_level = 75 then 'Glow Backsword'
  when required_level = 80 then 'Bloom Backsword'
  when required_level = 85 then 'Solar Backsword'
  when required_level = 90 then 'Conflict Backsword'
  when required_level = 95 then 'Origin Backsword'
  when required_level = 100 then 'Mist Backsword'
  when required_level = 105 then 'Zephyr Backsword'
  when required_level = 110 then 'Thunder Backsword'
  when required_level = 115 then 'Conquest Backsword'
  when required_level between 120 and 124 then 'Astral Backsword'
  when required_level between 125 and 129 then 'Celestial Backsword'
  when required_level = 130 then 'Eternity Backsword'
  else name end
where item_family = 'backsword';

commit;
