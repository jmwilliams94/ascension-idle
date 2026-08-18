-- Renames every Twin-soul/Wuxia/Juggernaut item to fix widespread name
-- collisions the user flagged -- Astral/Celestial/Eternity (and the low/mid
-- tier prefix words) were being reused identically across Club/Sword/Blade/
-- Maul/Backsword and every armor/accessory family. Each weapon type, armor
-- slot, and accessory line now gets its own fully distinct vocabulary (194
-- unique words total) -- only exception is that Twin-soul's and Juggernaut's
-- duplicate copies of the same weapon type (e.g. club-twinsoul/club-
-- juggernaut/club-offhand-twinsoul) still share names, which is intentional
-- (same conceptual item, per the original catalog migrations).
--
-- Also renames Twin-soul's chest slot from Mail to Armor per the user
-- (the item_family key stays 'mail' internally -- only the display name's
-- suffix word changes), and applies the user's shortening rule throughout:
-- a two-word compound keeps whichever half reads more like a mage/fantasy
-- flavor word and drops the other (e.g. the original Backsword chain's
-- Willowfang/Duskleaf/Mistveil become Willow/Dusk/Mist).
--
-- Backsword keeps Astral/Celestial/Eternity as its own exclusive top-tier
-- band (fits its mystic theme best); every other family got a fresh
-- top-tier trio (duo for Bracelet, which caps at 126, not 130).
begin;

  -- backsword -> "Backsword"
  update public.item_templates set name = 'Willow Backsword' where item_family = 'backsword' and required_level = 8;
  update public.item_templates set name = 'Dusk Backsword' where item_family = 'backsword' and required_level = 15;
  update public.item_templates set name = 'Mist Backsword' where item_family = 'backsword' and required_level = 20;
  update public.item_templates set name = 'Ash Backsword' where item_family = 'backsword' and required_level = 25;
  update public.item_templates set name = 'Cinder Backsword' where item_family = 'backsword' and required_level = 30;
  update public.item_templates set name = 'Hollow Backsword' where item_family = 'backsword' and required_level = 35;
  update public.item_templates set name = 'Raven Backsword' where item_family = 'backsword' and required_level = 40;
  update public.item_templates set name = 'Bloom Backsword' where item_family = 'backsword' and required_level = 45;
  update public.item_templates set name = 'Veil Backsword' where item_family = 'backsword' and required_level = 50;
  update public.item_templates set name = 'Shadow Backsword' where item_family = 'backsword' and required_level = 55;
  update public.item_templates set name = 'Lotus Backsword' where item_family = 'backsword' and required_level = 60;
  update public.item_templates set name = 'Whisper Backsword' where item_family = 'backsword' and required_level = 65;
  update public.item_templates set name = 'Soul Backsword' where item_family = 'backsword' and required_level = 70;
  update public.item_templates set name = 'Sage Backsword' where item_family = 'backsword' and required_level = 75;
  update public.item_templates set name = 'Moon Backsword' where item_family = 'backsword' and required_level = 80;
  update public.item_templates set name = 'Spirit Backsword' where item_family = 'backsword' and required_level = 85;
  update public.item_templates set name = 'Hallow Backsword' where item_family = 'backsword' and required_level = 90;
  update public.item_templates set name = 'Void Backsword' where item_family = 'backsword' and required_level = 95;
  update public.item_templates set name = 'Star Backsword' where item_family = 'backsword' and required_level = 100;
  update public.item_templates set name = 'Nether Backsword' where item_family = 'backsword' and required_level = 105;
  update public.item_templates set name = 'Sky Backsword' where item_family = 'backsword' and required_level = 110;
  update public.item_templates set name = 'Petal Backsword' where item_family = 'backsword' and required_level = 115;
  update public.item_templates set name = 'Astral Backsword' where item_family = 'backsword' and required_level = 120;
  update public.item_templates set name = 'Astral Backsword' where item_family = 'backsword' and required_level = 121;
  update public.item_templates set name = 'Astral Backsword' where item_family = 'backsword' and required_level = 122;
  update public.item_templates set name = 'Astral Backsword' where item_family = 'backsword' and required_level = 123;
  update public.item_templates set name = 'Astral Backsword' where item_family = 'backsword' and required_level = 124;
  update public.item_templates set name = 'Celestial Backsword' where item_family = 'backsword' and required_level = 125;
  update public.item_templates set name = 'Celestial Backsword' where item_family = 'backsword' and required_level = 126;
  update public.item_templates set name = 'Celestial Backsword' where item_family = 'backsword' and required_level = 127;
  update public.item_templates set name = 'Celestial Backsword' where item_family = 'backsword' and required_level = 128;
  update public.item_templates set name = 'Celestial Backsword' where item_family = 'backsword' and required_level = 129;
  update public.item_templates set name = 'Eternity Backsword' where item_family = 'backsword' and required_level = 130;

  -- club-twinsoul -> "Club"
  update public.item_templates set name = 'Rust Club' where item_family = 'club-twinsoul' and required_level = 8;
  update public.item_templates set name = 'Bramble Club' where item_family = 'club-twinsoul' and required_level = 15;
  update public.item_templates set name = 'Battle Club' where item_family = 'club-twinsoul' and required_level = 20;
  update public.item_templates set name = 'Fallen Club' where item_family = 'club-twinsoul' and required_level = 25;
  update public.item_templates set name = 'Dire Club' where item_family = 'club-twinsoul' and required_level = 30;
  update public.item_templates set name = 'Bone Club' where item_family = 'club-twinsoul' and required_level = 35;
  update public.item_templates set name = 'Skull Club' where item_family = 'club-twinsoul' and required_level = 40;
  update public.item_templates set name = 'Brute Club' where item_family = 'club-twinsoul' and required_level = 45;
  update public.item_templates set name = 'Crag Club' where item_family = 'club-twinsoul' and required_level = 50;
  update public.item_templates set name = 'Fist Club' where item_family = 'club-twinsoul' and required_level = 55;
  update public.item_templates set name = 'Rubble Club' where item_family = 'club-twinsoul' and required_level = 60;
  update public.item_templates set name = 'Gravel Club' where item_family = 'club-twinsoul' and required_level = 65;
  update public.item_templates set name = 'Boulder Club' where item_family = 'club-twinsoul' and required_level = 70;
  update public.item_templates set name = 'Anvil Club' where item_family = 'club-twinsoul' and required_level = 75;
  update public.item_templates set name = 'Stump Club' where item_family = 'club-twinsoul' and required_level = 80;
  update public.item_templates set name = 'Root Club' where item_family = 'club-twinsoul' and required_level = 85;
  update public.item_templates set name = 'Clay Club' where item_family = 'club-twinsoul' and required_level = 90;
  update public.item_templates set name = 'Mud Club' where item_family = 'club-twinsoul' and required_level = 95;
  update public.item_templates set name = 'Split Club' where item_family = 'club-twinsoul' and required_level = 100;
  update public.item_templates set name = 'Splinter Club' where item_family = 'club-twinsoul' and required_level = 105;
  update public.item_templates set name = 'Crush Club' where item_family = 'club-twinsoul' and required_level = 110;
  update public.item_templates set name = 'Grind Club' where item_family = 'club-twinsoul' and required_level = 115;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-twinsoul' and required_level = 120;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-twinsoul' and required_level = 121;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-twinsoul' and required_level = 122;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-twinsoul' and required_level = 123;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-twinsoul' and required_level = 124;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-twinsoul' and required_level = 125;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-twinsoul' and required_level = 126;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-twinsoul' and required_level = 127;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-twinsoul' and required_level = 128;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-twinsoul' and required_level = 129;
  update public.item_templates set name = 'Cataclysmic Club' where item_family = 'club-twinsoul' and required_level = 130;

  -- club-juggernaut -> "Club"
  update public.item_templates set name = 'Rust Club' where item_family = 'club-juggernaut' and required_level = 8;
  update public.item_templates set name = 'Bramble Club' where item_family = 'club-juggernaut' and required_level = 15;
  update public.item_templates set name = 'Battle Club' where item_family = 'club-juggernaut' and required_level = 20;
  update public.item_templates set name = 'Fallen Club' where item_family = 'club-juggernaut' and required_level = 25;
  update public.item_templates set name = 'Dire Club' where item_family = 'club-juggernaut' and required_level = 30;
  update public.item_templates set name = 'Bone Club' where item_family = 'club-juggernaut' and required_level = 35;
  update public.item_templates set name = 'Skull Club' where item_family = 'club-juggernaut' and required_level = 40;
  update public.item_templates set name = 'Brute Club' where item_family = 'club-juggernaut' and required_level = 45;
  update public.item_templates set name = 'Crag Club' where item_family = 'club-juggernaut' and required_level = 50;
  update public.item_templates set name = 'Fist Club' where item_family = 'club-juggernaut' and required_level = 55;
  update public.item_templates set name = 'Rubble Club' where item_family = 'club-juggernaut' and required_level = 60;
  update public.item_templates set name = 'Gravel Club' where item_family = 'club-juggernaut' and required_level = 65;
  update public.item_templates set name = 'Boulder Club' where item_family = 'club-juggernaut' and required_level = 70;
  update public.item_templates set name = 'Anvil Club' where item_family = 'club-juggernaut' and required_level = 75;
  update public.item_templates set name = 'Stump Club' where item_family = 'club-juggernaut' and required_level = 80;
  update public.item_templates set name = 'Root Club' where item_family = 'club-juggernaut' and required_level = 85;
  update public.item_templates set name = 'Clay Club' where item_family = 'club-juggernaut' and required_level = 90;
  update public.item_templates set name = 'Mud Club' where item_family = 'club-juggernaut' and required_level = 95;
  update public.item_templates set name = 'Split Club' where item_family = 'club-juggernaut' and required_level = 100;
  update public.item_templates set name = 'Splinter Club' where item_family = 'club-juggernaut' and required_level = 105;
  update public.item_templates set name = 'Crush Club' where item_family = 'club-juggernaut' and required_level = 110;
  update public.item_templates set name = 'Grind Club' where item_family = 'club-juggernaut' and required_level = 115;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-juggernaut' and required_level = 120;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-juggernaut' and required_level = 121;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-juggernaut' and required_level = 122;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-juggernaut' and required_level = 123;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-juggernaut' and required_level = 124;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-juggernaut' and required_level = 125;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-juggernaut' and required_level = 126;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-juggernaut' and required_level = 127;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-juggernaut' and required_level = 128;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-juggernaut' and required_level = 129;
  update public.item_templates set name = 'Cataclysmic Club' where item_family = 'club-juggernaut' and required_level = 130;

  -- club-offhand-twinsoul -> "Club"
  update public.item_templates set name = 'Rust Club' where item_family = 'club-offhand-twinsoul' and required_level = 8;
  update public.item_templates set name = 'Bramble Club' where item_family = 'club-offhand-twinsoul' and required_level = 15;
  update public.item_templates set name = 'Battle Club' where item_family = 'club-offhand-twinsoul' and required_level = 20;
  update public.item_templates set name = 'Fallen Club' where item_family = 'club-offhand-twinsoul' and required_level = 25;
  update public.item_templates set name = 'Dire Club' where item_family = 'club-offhand-twinsoul' and required_level = 30;
  update public.item_templates set name = 'Bone Club' where item_family = 'club-offhand-twinsoul' and required_level = 35;
  update public.item_templates set name = 'Skull Club' where item_family = 'club-offhand-twinsoul' and required_level = 40;
  update public.item_templates set name = 'Brute Club' where item_family = 'club-offhand-twinsoul' and required_level = 45;
  update public.item_templates set name = 'Crag Club' where item_family = 'club-offhand-twinsoul' and required_level = 50;
  update public.item_templates set name = 'Fist Club' where item_family = 'club-offhand-twinsoul' and required_level = 55;
  update public.item_templates set name = 'Rubble Club' where item_family = 'club-offhand-twinsoul' and required_level = 60;
  update public.item_templates set name = 'Gravel Club' where item_family = 'club-offhand-twinsoul' and required_level = 65;
  update public.item_templates set name = 'Boulder Club' where item_family = 'club-offhand-twinsoul' and required_level = 70;
  update public.item_templates set name = 'Anvil Club' where item_family = 'club-offhand-twinsoul' and required_level = 75;
  update public.item_templates set name = 'Stump Club' where item_family = 'club-offhand-twinsoul' and required_level = 80;
  update public.item_templates set name = 'Root Club' where item_family = 'club-offhand-twinsoul' and required_level = 85;
  update public.item_templates set name = 'Clay Club' where item_family = 'club-offhand-twinsoul' and required_level = 90;
  update public.item_templates set name = 'Mud Club' where item_family = 'club-offhand-twinsoul' and required_level = 95;
  update public.item_templates set name = 'Split Club' where item_family = 'club-offhand-twinsoul' and required_level = 100;
  update public.item_templates set name = 'Splinter Club' where item_family = 'club-offhand-twinsoul' and required_level = 105;
  update public.item_templates set name = 'Crush Club' where item_family = 'club-offhand-twinsoul' and required_level = 110;
  update public.item_templates set name = 'Grind Club' where item_family = 'club-offhand-twinsoul' and required_level = 115;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-offhand-twinsoul' and required_level = 120;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-offhand-twinsoul' and required_level = 121;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-offhand-twinsoul' and required_level = 122;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-offhand-twinsoul' and required_level = 123;
  update public.item_templates set name = 'Colossal Club' where item_family = 'club-offhand-twinsoul' and required_level = 124;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-offhand-twinsoul' and required_level = 125;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-offhand-twinsoul' and required_level = 126;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-offhand-twinsoul' and required_level = 127;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-offhand-twinsoul' and required_level = 128;
  update public.item_templates set name = 'Warmonger Club' where item_family = 'club-offhand-twinsoul' and required_level = 129;
  update public.item_templates set name = 'Cataclysmic Club' where item_family = 'club-offhand-twinsoul' and required_level = 130;

  -- longsword-twinsoul -> "Sword"
  update public.item_templates set name = 'Noble Sword' where item_family = 'longsword-twinsoul' and required_level = 8;
  update public.item_templates set name = 'Honor Sword' where item_family = 'longsword-twinsoul' and required_level = 15;
  update public.item_templates set name = 'Valor Sword' where item_family = 'longsword-twinsoul' and required_level = 20;
  update public.item_templates set name = 'Knight Sword' where item_family = 'longsword-twinsoul' and required_level = 25;
  update public.item_templates set name = 'Duel Sword' where item_family = 'longsword-twinsoul' and required_level = 30;
  update public.item_templates set name = 'Steel Sword' where item_family = 'longsword-twinsoul' and required_level = 35;
  update public.item_templates set name = 'Silver Sword' where item_family = 'longsword-twinsoul' and required_level = 40;
  update public.item_templates set name = 'Crest Sword' where item_family = 'longsword-twinsoul' and required_level = 45;
  update public.item_templates set name = 'Guard Sword' where item_family = 'longsword-twinsoul' and required_level = 50;
  update public.item_templates set name = 'Oath Sword' where item_family = 'longsword-twinsoul' and required_level = 55;
  update public.item_templates set name = 'Vow Sword' where item_family = 'longsword-twinsoul' and required_level = 60;
  update public.item_templates set name = 'Herald Sword' where item_family = 'longsword-twinsoul' and required_level = 65;
  update public.item_templates set name = 'Banner Sword' where item_family = 'longsword-twinsoul' and required_level = 70;
  update public.item_templates set name = 'Squire Sword' where item_family = 'longsword-twinsoul' and required_level = 75;
  update public.item_templates set name = 'Chivalry Sword' where item_family = 'longsword-twinsoul' and required_level = 80;
  update public.item_templates set name = 'Grace Sword' where item_family = 'longsword-twinsoul' and required_level = 85;
  update public.item_templates set name = 'Court Sword' where item_family = 'longsword-twinsoul' and required_level = 90;
  update public.item_templates set name = 'Regal Sword' where item_family = 'longsword-twinsoul' and required_level = 95;
  update public.item_templates set name = 'Blessed Sword' where item_family = 'longsword-twinsoul' and required_level = 100;
  update public.item_templates set name = 'Sworn Sword' where item_family = 'longsword-twinsoul' and required_level = 105;
  update public.item_templates set name = 'Champion Sword' where item_family = 'longsword-twinsoul' and required_level = 110;
  update public.item_templates set name = 'Realm Sword' where item_family = 'longsword-twinsoul' and required_level = 115;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-twinsoul' and required_level = 120;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-twinsoul' and required_level = 121;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-twinsoul' and required_level = 122;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-twinsoul' and required_level = 123;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-twinsoul' and required_level = 124;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-twinsoul' and required_level = 125;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-twinsoul' and required_level = 126;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-twinsoul' and required_level = 127;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-twinsoul' and required_level = 128;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-twinsoul' and required_level = 129;
  update public.item_templates set name = 'Immortal Sword' where item_family = 'longsword-twinsoul' and required_level = 130;

  -- longsword-juggernaut -> "Sword"
  update public.item_templates set name = 'Noble Sword' where item_family = 'longsword-juggernaut' and required_level = 8;
  update public.item_templates set name = 'Honor Sword' where item_family = 'longsword-juggernaut' and required_level = 15;
  update public.item_templates set name = 'Valor Sword' where item_family = 'longsword-juggernaut' and required_level = 20;
  update public.item_templates set name = 'Knight Sword' where item_family = 'longsword-juggernaut' and required_level = 25;
  update public.item_templates set name = 'Duel Sword' where item_family = 'longsword-juggernaut' and required_level = 30;
  update public.item_templates set name = 'Steel Sword' where item_family = 'longsword-juggernaut' and required_level = 35;
  update public.item_templates set name = 'Silver Sword' where item_family = 'longsword-juggernaut' and required_level = 40;
  update public.item_templates set name = 'Crest Sword' where item_family = 'longsword-juggernaut' and required_level = 45;
  update public.item_templates set name = 'Guard Sword' where item_family = 'longsword-juggernaut' and required_level = 50;
  update public.item_templates set name = 'Oath Sword' where item_family = 'longsword-juggernaut' and required_level = 55;
  update public.item_templates set name = 'Vow Sword' where item_family = 'longsword-juggernaut' and required_level = 60;
  update public.item_templates set name = 'Herald Sword' where item_family = 'longsword-juggernaut' and required_level = 65;
  update public.item_templates set name = 'Banner Sword' where item_family = 'longsword-juggernaut' and required_level = 70;
  update public.item_templates set name = 'Squire Sword' where item_family = 'longsword-juggernaut' and required_level = 75;
  update public.item_templates set name = 'Chivalry Sword' where item_family = 'longsword-juggernaut' and required_level = 80;
  update public.item_templates set name = 'Grace Sword' where item_family = 'longsword-juggernaut' and required_level = 85;
  update public.item_templates set name = 'Court Sword' where item_family = 'longsword-juggernaut' and required_level = 90;
  update public.item_templates set name = 'Regal Sword' where item_family = 'longsword-juggernaut' and required_level = 95;
  update public.item_templates set name = 'Blessed Sword' where item_family = 'longsword-juggernaut' and required_level = 100;
  update public.item_templates set name = 'Sworn Sword' where item_family = 'longsword-juggernaut' and required_level = 105;
  update public.item_templates set name = 'Champion Sword' where item_family = 'longsword-juggernaut' and required_level = 110;
  update public.item_templates set name = 'Realm Sword' where item_family = 'longsword-juggernaut' and required_level = 115;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-juggernaut' and required_level = 120;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-juggernaut' and required_level = 121;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-juggernaut' and required_level = 122;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-juggernaut' and required_level = 123;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-juggernaut' and required_level = 124;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-juggernaut' and required_level = 125;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-juggernaut' and required_level = 126;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-juggernaut' and required_level = 127;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-juggernaut' and required_level = 128;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-juggernaut' and required_level = 129;
  update public.item_templates set name = 'Immortal Sword' where item_family = 'longsword-juggernaut' and required_level = 130;

  -- longsword-offhand-twinsoul -> "Sword"
  update public.item_templates set name = 'Noble Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 8;
  update public.item_templates set name = 'Honor Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 15;
  update public.item_templates set name = 'Valor Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 20;
  update public.item_templates set name = 'Knight Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 25;
  update public.item_templates set name = 'Duel Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 30;
  update public.item_templates set name = 'Steel Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 35;
  update public.item_templates set name = 'Silver Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 40;
  update public.item_templates set name = 'Crest Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 45;
  update public.item_templates set name = 'Guard Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 50;
  update public.item_templates set name = 'Oath Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 55;
  update public.item_templates set name = 'Vow Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 60;
  update public.item_templates set name = 'Herald Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 65;
  update public.item_templates set name = 'Banner Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 70;
  update public.item_templates set name = 'Squire Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 75;
  update public.item_templates set name = 'Chivalry Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 80;
  update public.item_templates set name = 'Grace Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 85;
  update public.item_templates set name = 'Court Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 90;
  update public.item_templates set name = 'Regal Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 95;
  update public.item_templates set name = 'Blessed Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 100;
  update public.item_templates set name = 'Sworn Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 105;
  update public.item_templates set name = 'Champion Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 110;
  update public.item_templates set name = 'Realm Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 115;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 120;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 121;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 122;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 123;
  update public.item_templates set name = 'Peerless Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 124;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 125;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 126;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 127;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 128;
  update public.item_templates set name = 'Highlord Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 129;
  update public.item_templates set name = 'Immortal Sword' where item_family = 'longsword-offhand-twinsoul' and required_level = 130;

  -- blade-twinsoul -> "Blade"
  update public.item_templates set name = 'Swift Blade' where item_family = 'blade-twinsoul' and required_level = 8;
  update public.item_templates set name = 'Edge Blade' where item_family = 'blade-twinsoul' and required_level = 15;
  update public.item_templates set name = 'Sharp Blade' where item_family = 'blade-twinsoul' and required_level = 20;
  update public.item_templates set name = 'Wind Blade' where item_family = 'blade-twinsoul' and required_level = 25;
  update public.item_templates set name = 'Slash Blade' where item_family = 'blade-twinsoul' and required_level = 30;
  update public.item_templates set name = 'Razor Blade' where item_family = 'blade-twinsoul' and required_level = 35;
  update public.item_templates set name = 'Gust Blade' where item_family = 'blade-twinsoul' and required_level = 40;
  update public.item_templates set name = 'Keen Blade' where item_family = 'blade-twinsoul' and required_level = 45;
  update public.item_templates set name = 'Fang Blade' where item_family = 'blade-twinsoul' and required_level = 50;
  update public.item_templates set name = 'Reap Blade' where item_family = 'blade-twinsoul' and required_level = 55;
  update public.item_templates set name = 'Slice Blade' where item_family = 'blade-twinsoul' and required_level = 60;
  update public.item_templates set name = 'Sever Blade' where item_family = 'blade-twinsoul' and required_level = 65;
  update public.item_templates set name = 'Flick Blade' where item_family = 'blade-twinsoul' and required_level = 70;
  update public.item_templates set name = 'Streak Blade' where item_family = 'blade-twinsoul' and required_level = 75;
  update public.item_templates set name = 'Whip Blade' where item_family = 'blade-twinsoul' and required_level = 80;
  update public.item_templates set name = 'Dart Blade' where item_family = 'blade-twinsoul' and required_level = 85;
  update public.item_templates set name = 'Lunge Blade' where item_family = 'blade-twinsoul' and required_level = 90;
  update public.item_templates set name = 'Feint Blade' where item_family = 'blade-twinsoul' and required_level = 95;
  update public.item_templates set name = 'Rush Blade' where item_family = 'blade-twinsoul' and required_level = 100;
  update public.item_templates set name = 'Quick Blade' where item_family = 'blade-twinsoul' and required_level = 105;
  update public.item_templates set name = 'Glide Blade' where item_family = 'blade-twinsoul' and required_level = 110;
  update public.item_templates set name = 'Cleave Blade' where item_family = 'blade-twinsoul' and required_level = 115;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-twinsoul' and required_level = 120;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-twinsoul' and required_level = 121;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-twinsoul' and required_level = 122;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-twinsoul' and required_level = 123;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-twinsoul' and required_level = 124;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-twinsoul' and required_level = 125;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-twinsoul' and required_level = 126;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-twinsoul' and required_level = 127;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-twinsoul' and required_level = 128;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-twinsoul' and required_level = 129;
  update public.item_templates set name = 'Meridian Blade' where item_family = 'blade-twinsoul' and required_level = 130;

  -- blade-juggernaut -> "Blade"
  update public.item_templates set name = 'Swift Blade' where item_family = 'blade-juggernaut' and required_level = 8;
  update public.item_templates set name = 'Edge Blade' where item_family = 'blade-juggernaut' and required_level = 15;
  update public.item_templates set name = 'Sharp Blade' where item_family = 'blade-juggernaut' and required_level = 20;
  update public.item_templates set name = 'Wind Blade' where item_family = 'blade-juggernaut' and required_level = 25;
  update public.item_templates set name = 'Slash Blade' where item_family = 'blade-juggernaut' and required_level = 30;
  update public.item_templates set name = 'Razor Blade' where item_family = 'blade-juggernaut' and required_level = 35;
  update public.item_templates set name = 'Gust Blade' where item_family = 'blade-juggernaut' and required_level = 40;
  update public.item_templates set name = 'Keen Blade' where item_family = 'blade-juggernaut' and required_level = 45;
  update public.item_templates set name = 'Fang Blade' where item_family = 'blade-juggernaut' and required_level = 50;
  update public.item_templates set name = 'Reap Blade' where item_family = 'blade-juggernaut' and required_level = 55;
  update public.item_templates set name = 'Slice Blade' where item_family = 'blade-juggernaut' and required_level = 60;
  update public.item_templates set name = 'Sever Blade' where item_family = 'blade-juggernaut' and required_level = 65;
  update public.item_templates set name = 'Flick Blade' where item_family = 'blade-juggernaut' and required_level = 70;
  update public.item_templates set name = 'Streak Blade' where item_family = 'blade-juggernaut' and required_level = 75;
  update public.item_templates set name = 'Whip Blade' where item_family = 'blade-juggernaut' and required_level = 80;
  update public.item_templates set name = 'Dart Blade' where item_family = 'blade-juggernaut' and required_level = 85;
  update public.item_templates set name = 'Lunge Blade' where item_family = 'blade-juggernaut' and required_level = 90;
  update public.item_templates set name = 'Feint Blade' where item_family = 'blade-juggernaut' and required_level = 95;
  update public.item_templates set name = 'Rush Blade' where item_family = 'blade-juggernaut' and required_level = 100;
  update public.item_templates set name = 'Quick Blade' where item_family = 'blade-juggernaut' and required_level = 105;
  update public.item_templates set name = 'Glide Blade' where item_family = 'blade-juggernaut' and required_level = 110;
  update public.item_templates set name = 'Cleave Blade' where item_family = 'blade-juggernaut' and required_level = 115;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-juggernaut' and required_level = 120;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-juggernaut' and required_level = 121;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-juggernaut' and required_level = 122;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-juggernaut' and required_level = 123;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-juggernaut' and required_level = 124;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-juggernaut' and required_level = 125;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-juggernaut' and required_level = 126;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-juggernaut' and required_level = 127;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-juggernaut' and required_level = 128;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-juggernaut' and required_level = 129;
  update public.item_templates set name = 'Meridian Blade' where item_family = 'blade-juggernaut' and required_level = 130;

  -- blade-offhand-twinsoul -> "Blade"
  update public.item_templates set name = 'Swift Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 8;
  update public.item_templates set name = 'Edge Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 15;
  update public.item_templates set name = 'Sharp Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 20;
  update public.item_templates set name = 'Wind Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 25;
  update public.item_templates set name = 'Slash Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 30;
  update public.item_templates set name = 'Razor Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 35;
  update public.item_templates set name = 'Gust Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 40;
  update public.item_templates set name = 'Keen Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 45;
  update public.item_templates set name = 'Fang Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 50;
  update public.item_templates set name = 'Reap Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 55;
  update public.item_templates set name = 'Slice Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 60;
  update public.item_templates set name = 'Sever Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 65;
  update public.item_templates set name = 'Flick Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 70;
  update public.item_templates set name = 'Streak Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 75;
  update public.item_templates set name = 'Whip Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 80;
  update public.item_templates set name = 'Dart Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 85;
  update public.item_templates set name = 'Lunge Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 90;
  update public.item_templates set name = 'Feint Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 95;
  update public.item_templates set name = 'Rush Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 100;
  update public.item_templates set name = 'Quick Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 105;
  update public.item_templates set name = 'Glide Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 110;
  update public.item_templates set name = 'Cleave Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 115;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 120;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 121;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 122;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 123;
  update public.item_templates set name = 'Zenith Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 124;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 125;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 126;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 127;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 128;
  update public.item_templates set name = 'Tempest Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 129;
  update public.item_templates set name = 'Meridian Blade' where item_family = 'blade-offhand-twinsoul' and required_level = 130;

  -- greatmaul -> "Maul"
  update public.item_templates set name = 'Titan Maul' where item_family = 'greatmaul' and required_level = 8;
  update public.item_templates set name = 'Quake Maul' where item_family = 'greatmaul' and required_level = 15;
  update public.item_templates set name = 'Ruin Maul' where item_family = 'greatmaul' and required_level = 20;
  update public.item_templates set name = 'Colossus Maul' where item_family = 'greatmaul' and required_level = 25;
  update public.item_templates set name = 'Tremor Maul' where item_family = 'greatmaul' and required_level = 30;
  update public.item_templates set name = 'Crater Maul' where item_family = 'greatmaul' and required_level = 35;
  update public.item_templates set name = 'Landslide Maul' where item_family = 'greatmaul' and required_level = 40;
  update public.item_templates set name = 'Avalanche Maul' where item_family = 'greatmaul' and required_level = 45;
  update public.item_templates set name = 'Behemoth Maul' where item_family = 'greatmaul' and required_level = 50;
  update public.item_templates set name = 'Cataclysm Maul' where item_family = 'greatmaul' and required_level = 55;
  update public.item_templates set name = 'Fracture Maul' where item_family = 'greatmaul' and required_level = 60;
  update public.item_templates set name = 'Fissure Maul' where item_family = 'greatmaul' and required_level = 65;
  update public.item_templates set name = 'Rockfall Maul' where item_family = 'greatmaul' and required_level = 70;
  update public.item_templates set name = 'Mammoth Maul' where item_family = 'greatmaul' and required_level = 75;
  update public.item_templates set name = 'Bedrock Maul' where item_family = 'greatmaul' and required_level = 80;
  update public.item_templates set name = 'Granite Maul' where item_family = 'greatmaul' and required_level = 85;
  update public.item_templates set name = 'Impact Maul' where item_family = 'greatmaul' and required_level = 90;
  update public.item_templates set name = 'Wreck Maul' where item_family = 'greatmaul' and required_level = 95;
  update public.item_templates set name = 'Havoc Maul' where item_family = 'greatmaul' and required_level = 100;
  update public.item_templates set name = 'Rampage Maul' where item_family = 'greatmaul' and required_level = 105;
  update public.item_templates set name = 'Onslaught Maul' where item_family = 'greatmaul' and required_level = 110;
  update public.item_templates set name = 'Brawn Maul' where item_family = 'greatmaul' and required_level = 115;
  update public.item_templates set name = 'Ragnarok Maul' where item_family = 'greatmaul' and required_level = 120;
  update public.item_templates set name = 'Ragnarok Maul' where item_family = 'greatmaul' and required_level = 121;
  update public.item_templates set name = 'Ragnarok Maul' where item_family = 'greatmaul' and required_level = 122;
  update public.item_templates set name = 'Ragnarok Maul' where item_family = 'greatmaul' and required_level = 123;
  update public.item_templates set name = 'Ragnarok Maul' where item_family = 'greatmaul' and required_level = 124;
  update public.item_templates set name = 'Worldbreaker Maul' where item_family = 'greatmaul' and required_level = 125;
  update public.item_templates set name = 'Worldbreaker Maul' where item_family = 'greatmaul' and required_level = 126;
  update public.item_templates set name = 'Worldbreaker Maul' where item_family = 'greatmaul' and required_level = 127;
  update public.item_templates set name = 'Worldbreaker Maul' where item_family = 'greatmaul' and required_level = 128;
  update public.item_templates set name = 'Worldbreaker Maul' where item_family = 'greatmaul' and required_level = 129;
  update public.item_templates set name = 'Extinction Maul' where item_family = 'greatmaul' and required_level = 130;

  -- cap -> "Cap"
  update public.item_templates set name = 'Reed Cap' where item_family = 'cap' and required_level = 7;
  update public.item_templates set name = 'Silk Cap' where item_family = 'cap' and required_level = 17;
  update public.item_templates set name = 'Dawn Cap' where item_family = 'cap' and required_level = 27;
  update public.item_templates set name = 'Crane Cap' where item_family = 'cap' and required_level = 37;
  update public.item_templates set name = 'Weave Cap' where item_family = 'cap' and required_level = 45;
  update public.item_templates set name = 'Frostpetal Cap' where item_family = 'cap' and required_level = 52;
  update public.item_templates set name = 'Moonpetal Cap' where item_family = 'cap' and required_level = 67;
  update public.item_templates set name = 'Cloudsilk Cap' where item_family = 'cap' and required_level = 82;
  update public.item_templates set name = 'Jadeleaf Cap' where item_family = 'cap' and required_level = 97;
  update public.item_templates set name = 'Snowveil Cap' where item_family = 'cap' and required_level = 112;
  update public.item_templates set name = 'Skysworn Cap' where item_family = 'cap' and required_level = 120;
  update public.item_templates set name = 'Moonbound Cap' where item_family = 'cap' and required_level = 125;
  update public.item_templates set name = 'Heavensent Cap' where item_family = 'cap' and required_level = 130;

  -- robe -> "Robe"
  update public.item_templates set name = 'Hemp Robe' where item_family = 'robe' and required_level = 7;
  update public.item_templates set name = 'Sable Robe' where item_family = 'robe' and required_level = 17;
  update public.item_templates set name = 'Linen Robe' where item_family = 'robe' and required_level = 27;
  update public.item_templates set name = 'Gossamer Robe' where item_family = 'robe' and required_level = 37;
  update public.item_templates set name = 'Saffron Robe' where item_family = 'robe' and required_level = 45;
  update public.item_templates set name = 'Cloudspun Robe' where item_family = 'robe' and required_level = 52;
  update public.item_templates set name = 'Jadefall Robe' where item_family = 'robe' and required_level = 67;
  update public.item_templates set name = 'Duskbound Robe' where item_family = 'robe' and required_level = 82;
  update public.item_templates set name = 'Phoenixdown Robe' where item_family = 'robe' and required_level = 97;
  update public.item_templates set name = 'Ashweave Robe' where item_family = 'robe' and required_level = 112;
  update public.item_templates set name = 'Silkbound Robe' where item_family = 'robe' and required_level = 120;
  update public.item_templates set name = 'Cloudborn Robe' where item_family = 'robe' and required_level = 125;
  update public.item_templates set name = 'Heirloom Robe' where item_family = 'robe' and required_level = 130;

  -- coronet -> "Coronet"
  update public.item_templates set name = 'Circlet Coronet' where item_family = 'coronet' and required_level = 7;
  update public.item_templates set name = 'Ridge Coronet' where item_family = 'coronet' and required_level = 17;
  update public.item_templates set name = 'Brow Coronet' where item_family = 'coronet' and required_level = 27;
  update public.item_templates set name = 'Sentinel Coronet' where item_family = 'coronet' and required_level = 37;
  update public.item_templates set name = 'Warden Coronet' where item_family = 'coronet' and required_level = 45;
  update public.item_templates set name = 'Rampart Coronet' where item_family = 'coronet' and required_level = 52;
  update public.item_templates set name = 'Bulwark Coronet' where item_family = 'coronet' and required_level = 67;
  update public.item_templates set name = 'Palisade Coronet' where item_family = 'coronet' and required_level = 82;
  update public.item_templates set name = 'Vanguard Coronet' where item_family = 'coronet' and required_level = 97;
  update public.item_templates set name = 'Bastionward Coronet' where item_family = 'coronet' and required_level = 112;
  update public.item_templates set name = 'Kingsguard Coronet' where item_family = 'coronet' and required_level = 120;
  update public.item_templates set name = 'Highward Coronet' where item_family = 'coronet' and required_level = 125;
  update public.item_templates set name = 'Ironcrown Coronet' where item_family = 'coronet' and required_level = 130;

  -- mail -> "Armor"
  update public.item_templates set name = 'Chain Armor' where item_family = 'mail' and required_level = 7;
  update public.item_templates set name = 'Scale Armor' where item_family = 'mail' and required_level = 17;
  update public.item_templates set name = 'Plate Armor' where item_family = 'mail' and required_level = 27;
  update public.item_templates set name = 'Legion Armor' where item_family = 'mail' and required_level = 37;
  update public.item_templates set name = 'Forged Armor' where item_family = 'mail' and required_level = 45;
  update public.item_templates set name = 'Hide Armor' where item_family = 'mail' and required_level = 52;
  update public.item_templates set name = 'Broadcloth Armor' where item_family = 'mail' and required_level = 67;
  update public.item_templates set name = 'Warcloth Armor' where item_family = 'mail' and required_level = 82;
  update public.item_templates set name = 'Hearth Armor' where item_family = 'mail' and required_level = 97;
  update public.item_templates set name = 'Trench Armor' where item_family = 'mail' and required_level = 112;
  update public.item_templates set name = 'Bloodforged Armor' where item_family = 'mail' and required_level = 120;
  update public.item_templates set name = 'Warforged Armor' where item_family = 'mail' and required_level = 125;
  update public.item_templates set name = 'Ironbound Armor' where item_family = 'mail' and required_level = 130;

  -- helmet -> "Helmet"
  update public.item_templates set name = 'Basalt Helmet' where item_family = 'helmet' and required_level = 7;
  update public.item_templates set name = 'Rockjaw Helmet' where item_family = 'helmet' and required_level = 17;
  update public.item_templates set name = 'Ironjaw Helmet' where item_family = 'helmet' and required_level = 27;
  update public.item_templates set name = 'Slag Helmet' where item_family = 'helmet' and required_level = 37;
  update public.item_templates set name = 'Grimface Helmet' where item_family = 'helmet' and required_level = 45;
  update public.item_templates set name = 'Warhood Helmet' where item_family = 'helmet' and required_level = 52;
  update public.item_templates set name = 'Anvilcrown Helmet' where item_family = 'helmet' and required_level = 67;
  update public.item_templates set name = 'Ramshead Helmet' where item_family = 'helmet' and required_level = 82;
  update public.item_templates set name = 'Stonemask Helmet' where item_family = 'helmet' and required_level = 97;
  update public.item_templates set name = 'Ironbrow Helmet' where item_family = 'helmet' and required_level = 112;
  update public.item_templates set name = 'Skullking Helmet' where item_family = 'helmet' and required_level = 120;
  update public.item_templates set name = 'Warbound Helmet' where item_family = 'helmet' and required_level = 125;
  update public.item_templates set name = 'Ironmonger Helmet' where item_family = 'helmet' and required_level = 130;

  -- armor -> "Armor"
  update public.item_templates set name = 'Cinderhide Armor' where item_family = 'armor' and required_level = 7;
  update public.item_templates set name = 'Forgehide Armor' where item_family = 'armor' and required_level = 17;
  update public.item_templates set name = 'Rustplate Armor' where item_family = 'armor' and required_level = 27;
  update public.item_templates set name = 'Ashenhide Armor' where item_family = 'armor' and required_level = 37;
  update public.item_templates set name = 'Coalweave Armor' where item_family = 'armor' and required_level = 45;
  update public.item_templates set name = 'Sootguard Armor' where item_family = 'armor' and required_level = 52;
  update public.item_templates set name = 'Furnace Armor' where item_family = 'armor' and required_level = 67;
  update public.item_templates set name = 'Slaghide Armor' where item_family = 'armor' and required_level = 82;
  update public.item_templates set name = 'Blastplate Armor' where item_family = 'armor' and required_level = 97;
  update public.item_templates set name = 'Foundry Armor' where item_family = 'armor' and required_level = 112;
  update public.item_templates set name = 'Firebound Armor' where item_family = 'armor' and required_level = 120;
  update public.item_templates set name = 'Steelbound Armor' where item_family = 'armor' and required_level = 125;
  update public.item_templates set name = 'Molten Armor' where item_family = 'armor' and required_level = 130;

  -- shield -> "Shield"
  update public.item_templates set name = 'Aegis Shield' where item_family = 'shield' and required_level = 7;
  update public.item_templates set name = 'Bastionguard Shield' where item_family = 'shield' and required_level = 17;
  update public.item_templates set name = 'Buckler Shield' where item_family = 'shield' and required_level = 27;
  update public.item_templates set name = 'Bracer Shield' where item_family = 'shield' and required_level = 37;
  update public.item_templates set name = 'Wallguard Shield' where item_family = 'shield' and required_level = 45;
  update public.item_templates set name = 'Ironwall Shield' where item_family = 'shield' and required_level = 52;
  update public.item_templates set name = 'Stoneface Shield' where item_family = 'shield' and required_level = 67;
  update public.item_templates set name = 'Deflector Shield' where item_family = 'shield' and required_level = 82;
  update public.item_templates set name = 'Barrier Shield' where item_family = 'shield' and required_level = 97;
  update public.item_templates set name = 'Sunderguard Shield' where item_family = 'shield' and required_level = 112;
  update public.item_templates set name = 'Immovable Shield' where item_family = 'shield' and required_level = 120;
  update public.item_templates set name = 'Unbreakable Shield' where item_family = 'shield' and required_level = 125;
  update public.item_templates set name = 'Impenetrable Shield' where item_family = 'shield' and required_level = 130;

  -- bag -> "Bag"
  update public.item_templates set name = 'Cotton Bag' where item_family = 'bag' and required_level = 7;
  update public.item_templates set name = 'Woven Bag' where item_family = 'bag' and required_level = 17;
  update public.item_templates set name = 'Tassel Bag' where item_family = 'bag' and required_level = 27;
  update public.item_templates set name = 'Cord Bag' where item_family = 'bag' and required_level = 37;
  update public.item_templates set name = 'Pouch Bag' where item_family = 'bag' and required_level = 45;
  update public.item_templates set name = 'Cloth Bag' where item_family = 'bag' and required_level = 52;
  update public.item_templates set name = 'Rope Bag' where item_family = 'bag' and required_level = 67;
  update public.item_templates set name = 'Satchel Bag' where item_family = 'bag' and required_level = 82;
  update public.item_templates set name = 'Plume Bag' where item_family = 'bag' and required_level = 97;
  update public.item_templates set name = 'Charm Bag' where item_family = 'bag' and required_level = 112;
  update public.item_templates set name = 'Silksworn Bag' where item_family = 'bag' and required_level = 120;
  update public.item_templates set name = 'Moonlit Bag' where item_family = 'bag' and required_level = 125;
  update public.item_templates set name = 'Threadgold Bag' where item_family = 'bag' and required_level = 130;

  -- bracelet -> "Bracelet"
  update public.item_templates set name = 'Copper Bracelet' where item_family = 'bracelet' and required_level = 1;
  update public.item_templates set name = 'Bead Bracelet' where item_family = 'bracelet' and required_level = 10;
  update public.item_templates set name = 'Jasper Bracelet' where item_family = 'bracelet' and required_level = 20;
  update public.item_templates set name = 'Coral Bracelet' where item_family = 'bracelet' and required_level = 30;
  update public.item_templates set name = 'Onyx Bracelet' where item_family = 'bracelet' and required_level = 40;
  update public.item_templates set name = 'Amberwood Bracelet' where item_family = 'bracelet' and required_level = 50;
  update public.item_templates set name = 'Serpentine Bracelet' where item_family = 'bracelet' and required_level = 60;
  update public.item_templates set name = 'Moonstone Bracelet' where item_family = 'bracelet' and required_level = 70;
  update public.item_templates set name = 'Garnet Bracelet' where item_family = 'bracelet' and required_level = 80;
  update public.item_templates set name = 'Crystal Bracelet' where item_family = 'bracelet' and required_level = 90;
  update public.item_templates set name = 'Forgedwire Bracelet' where item_family = 'bracelet' and required_level = 100;
  update public.item_templates set name = 'Filigree Bracelet' where item_family = 'bracelet' and required_level = 110;
  update public.item_templates set name = 'Beryl Bracelet' where item_family = 'bracelet' and required_level = 116;
  update public.item_templates set name = 'Radiant Bracelet' where item_family = 'bracelet' and required_level = 121;
  update public.item_templates set name = 'Prismatic Bracelet' where item_family = 'bracelet' and required_level = 126;


commit;
