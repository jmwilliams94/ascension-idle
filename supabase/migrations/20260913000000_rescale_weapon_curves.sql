-- Rescales the placeholder weapon curves from the previous 3 migrations
-- (20260909000000_wuxia_gear_catalog.sql, 20260911000000_twin_soul_gear_
-- catalog.sql, 20260912000000_juggernaut_gear_catalog.sql). Those all reused
-- Bow's exact physical_attack/dexterity numbers verbatim for every new
-- weapon family, which threw away the real relative power differences
-- between weapon types the Conquer reference data shows (e.g. Club hits far
-- harder than Backsword in the source). Fixed by scaling each family's own
-- curve by its real level-130 Max Atk ratio against Bow's own real level-130
-- Max Atk (Shadow Bow, 2558 -- reference/conquer-items/bows.md), then
-- applying that same ratio across all 33 of Bow's own level breakpoints:
--   backsword  x0.3213 (822/2558)   -- magic_attack, not physical_attack
--   longsword  x0.8679 (2220/2558)
--   blade      x1.0066 (2575/2558)
--   greatmaul  x1.1611 (2970/2558)
--   club       x1.2224 (3127/2558)
-- Dexterity is then re-derived from each family's own new attack value via
-- the existing round(atk * 0.15), floored at 1 rule (20260802020000_add_
-- bow_ring_dexterity.sql) -- not a second linear scaling of Bow's own
-- dexterity numbers, to stay consistent with how dexterity was always meant
-- to be derived.
--
-- Twin-soul's and Juggernaut's Club/Sword/Blade share the same multiplier
-- per weapon type (same real-world item, two independently-gated chains --
-- see the original catalog migrations' own notes on why they're split).
--
-- Twin-soul's off-hand slot is also restructured here, per the user: it
-- shouldn't be one generic invented 'Twinblade' family (which had no real
-- source ratio to preserve) -- the off-hand item should just be whichever
-- of Club/Sword/Blade the player is dual-wielding, with identical stats to
-- the main-hand version. The old 'offhand-twinsoul' family (33 rows) is
-- deleted and replaced with 3 real per-weapon-type off-hand chains
-- (club-offhand-twinsoul/longsword-offhand-twinsoul/blade-offhand-twinsoul,
-- slot_type='quiver' so they occupy the second-hand slot), each an exact
-- stat mirror of its main-hand counterpart.
--
-- Backsword being a magic_attack weapon is unaffected by this restructuring
-- -- it never had a physical_attack key (Wuxia's own gear gap this fixed,
-- see CLAUDE.gear-and-forge.md), only its magic_attack/dexterity numbers
-- are rescaled here.
begin;

-- backsword (x0.3213)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '2'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '3'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '4'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '5'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '19'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '22'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '26'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'backsword' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '28'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'backsword' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '31'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '36'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '39'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '41'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '44'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '45'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '45'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '46'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '47'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '47'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '48'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '50'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'backsword' and required_level = 130;

-- club-twinsoul (x1.2224)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'club-twinsoul' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-twinsoul' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-twinsoul' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '21'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-twinsoul' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '24'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-twinsoul' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '29'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-twinsoul' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '35'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'club-twinsoul' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '40'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'club-twinsoul' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '46'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'club-twinsoul' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '53'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'club-twinsoul' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '60'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'club-twinsoul' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '66'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'club-twinsoul' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '73'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'club-twinsoul' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '82'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'club-twinsoul' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'club-twinsoul' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '98'::jsonb), '{dexterity}', '15'::jsonb) where item_family = 'club-twinsoul' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '108'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'club-twinsoul' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '116'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'club-twinsoul' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '126'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'club-twinsoul' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '136'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'club-twinsoul' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '147'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'club-twinsoul' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '156'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'club-twinsoul' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '167'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'club-twinsoul' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '170'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-twinsoul' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '172'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-twinsoul' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '175'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-twinsoul' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '177'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-twinsoul' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '180'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-twinsoul' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '182'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-twinsoul' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '185'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-twinsoul' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '187'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-twinsoul' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '188'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-twinsoul' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '191'::jsonb), '{dexterity}', '29'::jsonb) where item_family = 'club-twinsoul' and required_level = 130;

-- longsword-twinsoul (x0.8679)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '15'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '21'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '25'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '29'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '37'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '47'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '52'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '58'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '63'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '69'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '76'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '82'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '96'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '104'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '111'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '119'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '121'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '122'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '124'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '126'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '128'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '129'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '131'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '133'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '134'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '135'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 130;

-- blade-twinsoul (x1.0066)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-twinsoul' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-twinsoul' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '13'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-twinsoul' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-twinsoul' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-twinsoul' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '24'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'blade-twinsoul' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '29'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'blade-twinsoul' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'blade-twinsoul' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'blade-twinsoul' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'blade-twinsoul' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'blade-twinsoul' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '54'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'blade-twinsoul' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '60'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'blade-twinsoul' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '67'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'blade-twinsoul' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '73'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'blade-twinsoul' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '81'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'blade-twinsoul' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'blade-twinsoul' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '96'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'blade-twinsoul' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '104'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'blade-twinsoul' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '112'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'blade-twinsoul' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '121'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'blade-twinsoul' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '129'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'blade-twinsoul' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '138'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-twinsoul' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '140'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-twinsoul' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '142'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-twinsoul' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '144'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-twinsoul' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '146'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-twinsoul' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '148'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-twinsoul' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '150'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-twinsoul' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '152'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-twinsoul' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '154'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-twinsoul' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '155'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-twinsoul' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '157'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'blade-twinsoul' and required_level = 130;

-- club-juggernaut (x1.2224)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'club-juggernaut' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-juggernaut' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-juggernaut' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '21'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-juggernaut' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '24'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-juggernaut' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '29'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-juggernaut' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '35'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'club-juggernaut' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '40'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'club-juggernaut' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '46'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'club-juggernaut' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '53'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'club-juggernaut' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '60'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'club-juggernaut' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '66'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'club-juggernaut' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '73'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'club-juggernaut' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '82'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'club-juggernaut' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'club-juggernaut' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '98'::jsonb), '{dexterity}', '15'::jsonb) where item_family = 'club-juggernaut' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '108'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'club-juggernaut' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '116'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'club-juggernaut' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '126'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'club-juggernaut' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '136'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'club-juggernaut' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '147'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'club-juggernaut' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '156'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'club-juggernaut' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '167'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'club-juggernaut' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '170'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-juggernaut' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '172'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-juggernaut' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '175'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-juggernaut' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '177'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-juggernaut' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '180'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-juggernaut' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '182'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-juggernaut' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '185'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-juggernaut' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '187'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-juggernaut' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '188'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-juggernaut' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '191'::jsonb), '{dexterity}', '29'::jsonb) where item_family = 'club-juggernaut' and required_level = 130;

-- longsword-juggernaut (x0.8679)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '15'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '21'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '25'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '29'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '37'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '47'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '52'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '58'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '63'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '69'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '76'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '82'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '96'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '104'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '111'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '119'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '121'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '122'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '124'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '126'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '128'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '129'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '131'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '133'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '134'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '135'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 130;

-- blade-juggernaut (x1.0066)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-juggernaut' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-juggernaut' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '13'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-juggernaut' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-juggernaut' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-juggernaut' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '24'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'blade-juggernaut' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '29'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'blade-juggernaut' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'blade-juggernaut' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'blade-juggernaut' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'blade-juggernaut' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'blade-juggernaut' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '54'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'blade-juggernaut' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '60'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'blade-juggernaut' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '67'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'blade-juggernaut' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '73'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'blade-juggernaut' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '81'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'blade-juggernaut' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'blade-juggernaut' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '96'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'blade-juggernaut' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '104'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'blade-juggernaut' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '112'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'blade-juggernaut' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '121'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'blade-juggernaut' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '129'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'blade-juggernaut' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '138'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-juggernaut' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '140'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-juggernaut' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '142'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-juggernaut' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '144'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-juggernaut' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '146'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-juggernaut' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '148'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-juggernaut' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '150'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-juggernaut' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '152'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-juggernaut' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '154'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-juggernaut' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '155'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-juggernaut' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '157'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'blade-juggernaut' and required_level = 130;

-- greatmaul (x1.1611)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'greatmaul' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'greatmaul' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '15'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'greatmaul' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'greatmaul' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'greatmaul' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '28'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'greatmaul' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '34'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'greatmaul' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'greatmaul' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '44'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'greatmaul' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '50'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'greatmaul' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '57'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'greatmaul' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '63'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'greatmaul' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '70'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'greatmaul' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '78'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'greatmaul' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '85'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'greatmaul' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '93'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'greatmaul' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '102'::jsonb), '{dexterity}', '15'::jsonb) where item_family = 'greatmaul' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '110'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'greatmaul' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '120'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'greatmaul' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '129'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'greatmaul' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '139'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'greatmaul' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '149'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'greatmaul' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '159'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'greatmaul' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '161'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'greatmaul' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '164'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'greatmaul' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '166'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'greatmaul' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '168'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'greatmaul' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '171'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'greatmaul' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '173'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'greatmaul' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '175'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'greatmaul' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '178'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'greatmaul' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '179'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'greatmaul' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '181'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'greatmaul' and required_level = 130;


-- Replace the old generic Twinblade off-hand family with 3 real per-weapon-
-- type off-hand chains (see header).
delete from public.item_templates where item_family = 'offhand-twinsoul';

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values
  -- club-offhand-twinsoul (x1.2224, mirrors club-twinsoul)
  ('Rustcut Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":9,"dexterity":1}'::jsonb, 8, 'twin-soul'),
  ('Ironbound Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":12,"dexterity":2}'::jsonb, 15, 'twin-soul'),
  ('Steelfang Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":16,"dexterity":2}'::jsonb, 20, 'twin-soul'),
  ('Bloodedge Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":21,"dexterity":3}'::jsonb, 25, 'twin-soul'),
  ('Battleworn Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":24,"dexterity":4}'::jsonb, 30, 'twin-soul'),
  ('Warforged Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":29,"dexterity":4}'::jsonb, 35, 'twin-soul'),
  ('Grimsteel Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":35,"dexterity":5}'::jsonb, 40, 'twin-soul'),
  ('Ashfallen Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":40,"dexterity":6}'::jsonb, 45, 'twin-soul'),
  ('Direheart Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":46,"dexterity":7}'::jsonb, 50, 'twin-soul'),
  ('Bramblefang Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":53,"dexterity":8}'::jsonb, 55, 'twin-soul'),
  ('Nightstrike Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":60,"dexterity":9}'::jsonb, 60, 'twin-soul'),
  ('Frostbrand Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":66,"dexterity":10}'::jsonb, 65, 'twin-soul'),
  ('Stormedge Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":73,"dexterity":11}'::jsonb, 70, 'twin-soul'),
  ('Ironclad Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":82,"dexterity":12}'::jsonb, 75, 'twin-soul'),
  ('Bloodoath Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":89,"dexterity":13}'::jsonb, 80, 'twin-soul'),
  ('Grimward Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":98,"dexterity":15}'::jsonb, 85, 'twin-soul'),
  ('Skullrend Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":108,"dexterity":16}'::jsonb, 90, 'twin-soul'),
  ('Doomforge Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":116,"dexterity":17}'::jsonb, 95, 'twin-soul'),
  ('Wrathbound Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":126,"dexterity":19}'::jsonb, 100, 'twin-soul'),
  ('Shadowstrike Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":136,"dexterity":20}'::jsonb, 105, 'twin-soul'),
  ('Vengeance Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":147,"dexterity":22}'::jsonb, 110, 'twin-soul'),
  ('Warbringer Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":156,"dexterity":23}'::jsonb, 115, 'twin-soul'),
  ('Astral Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":167,"dexterity":25}'::jsonb, 120, 'twin-soul'),
  ('Astral Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":170,"dexterity":26}'::jsonb, 121, 'twin-soul'),
  ('Astral Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":172,"dexterity":26}'::jsonb, 122, 'twin-soul'),
  ('Astral Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":175,"dexterity":26}'::jsonb, 123, 'twin-soul'),
  ('Astral Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":177,"dexterity":27}'::jsonb, 124, 'twin-soul'),
  ('Celestial Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":180,"dexterity":27}'::jsonb, 125, 'twin-soul'),
  ('Celestial Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":182,"dexterity":27}'::jsonb, 126, 'twin-soul'),
  ('Celestial Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":185,"dexterity":28}'::jsonb, 127, 'twin-soul'),
  ('Celestial Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":187,"dexterity":28}'::jsonb, 128, 'twin-soul'),
  ('Celestial Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":188,"dexterity":28}'::jsonb, 129, 'twin-soul'),
  ('Eternity Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":191,"dexterity":29}'::jsonb, 130, 'twin-soul'),
  -- longsword-offhand-twinsoul (x0.8679, mirrors longsword-twinsoul)
  ('Rustcut Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":6,"dexterity":1}'::jsonb, 8, 'twin-soul'),
  ('Ironbound Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":9,"dexterity":1}'::jsonb, 15, 'twin-soul'),
  ('Steelfang Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":11,"dexterity":2}'::jsonb, 20, 'twin-soul'),
  ('Bloodedge Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":15,"dexterity":2}'::jsonb, 25, 'twin-soul'),
  ('Battleworn Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":17,"dexterity":3}'::jsonb, 30, 'twin-soul'),
  ('Warforged Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":21,"dexterity":3}'::jsonb, 35, 'twin-soul'),
  ('Grimsteel Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":25,"dexterity":4}'::jsonb, 40, 'twin-soul'),
  ('Ashfallen Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":29,"dexterity":4}'::jsonb, 45, 'twin-soul'),
  ('Direheart Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":33,"dexterity":5}'::jsonb, 50, 'twin-soul'),
  ('Bramblefang Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":37,"dexterity":6}'::jsonb, 55, 'twin-soul'),
  ('Nightstrike Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":43,"dexterity":6}'::jsonb, 60, 'twin-soul'),
  ('Frostbrand Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":47,"dexterity":7}'::jsonb, 65, 'twin-soul'),
  ('Stormedge Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":52,"dexterity":8}'::jsonb, 70, 'twin-soul'),
  ('Ironclad Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":58,"dexterity":9}'::jsonb, 75, 'twin-soul'),
  ('Bloodoath Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":63,"dexterity":9}'::jsonb, 80, 'twin-soul'),
  ('Grimward Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":69,"dexterity":10}'::jsonb, 85, 'twin-soul'),
  ('Skullrend Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":76,"dexterity":11}'::jsonb, 90, 'twin-soul'),
  ('Doomforge Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":82,"dexterity":12}'::jsonb, 95, 'twin-soul'),
  ('Wrathbound Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":89,"dexterity":13}'::jsonb, 100, 'twin-soul'),
  ('Shadowstrike Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":96,"dexterity":14}'::jsonb, 105, 'twin-soul'),
  ('Vengeance Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":104,"dexterity":16}'::jsonb, 110, 'twin-soul'),
  ('Warbringer Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":111,"dexterity":17}'::jsonb, 115, 'twin-soul'),
  ('Astral Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":119,"dexterity":18}'::jsonb, 120, 'twin-soul'),
  ('Astral Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":121,"dexterity":18}'::jsonb, 121, 'twin-soul'),
  ('Astral Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":122,"dexterity":18}'::jsonb, 122, 'twin-soul'),
  ('Astral Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":124,"dexterity":19}'::jsonb, 123, 'twin-soul'),
  ('Astral Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":126,"dexterity":19}'::jsonb, 124, 'twin-soul'),
  ('Celestial Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":128,"dexterity":19}'::jsonb, 125, 'twin-soul'),
  ('Celestial Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":129,"dexterity":19}'::jsonb, 126, 'twin-soul'),
  ('Celestial Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":131,"dexterity":20}'::jsonb, 127, 'twin-soul'),
  ('Celestial Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":133,"dexterity":20}'::jsonb, 128, 'twin-soul'),
  ('Celestial Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":134,"dexterity":20}'::jsonb, 129, 'twin-soul'),
  ('Eternity Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":135,"dexterity":20}'::jsonb, 130, 'twin-soul'),
  -- blade-offhand-twinsoul (x1.0066, mirrors blade-twinsoul)
  ('Rustcut Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":7,"dexterity":1}'::jsonb, 8, 'twin-soul'),
  ('Ironbound Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":10,"dexterity":2}'::jsonb, 15, 'twin-soul'),
  ('Steelfang Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":13,"dexterity":2}'::jsonb, 20, 'twin-soul'),
  ('Bloodedge Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":17,"dexterity":3}'::jsonb, 25, 'twin-soul'),
  ('Battleworn Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":20,"dexterity":3}'::jsonb, 30, 'twin-soul'),
  ('Warforged Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":24,"dexterity":4}'::jsonb, 35, 'twin-soul'),
  ('Grimsteel Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":29,"dexterity":4}'::jsonb, 40, 'twin-soul'),
  ('Ashfallen Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":33,"dexterity":5}'::jsonb, 45, 'twin-soul'),
  ('Direheart Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":38,"dexterity":6}'::jsonb, 50, 'twin-soul'),
  ('Bramblefang Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":43,"dexterity":6}'::jsonb, 55, 'twin-soul'),
  ('Nightstrike Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":49,"dexterity":7}'::jsonb, 60, 'twin-soul'),
  ('Frostbrand Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":54,"dexterity":8}'::jsonb, 65, 'twin-soul'),
  ('Stormedge Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":60,"dexterity":9}'::jsonb, 70, 'twin-soul'),
  ('Ironclad Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":67,"dexterity":10}'::jsonb, 75, 'twin-soul'),
  ('Bloodoath Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":73,"dexterity":11}'::jsonb, 80, 'twin-soul'),
  ('Grimward Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":81,"dexterity":12}'::jsonb, 85, 'twin-soul'),
  ('Skullrend Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":89,"dexterity":13}'::jsonb, 90, 'twin-soul'),
  ('Doomforge Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":96,"dexterity":14}'::jsonb, 95, 'twin-soul'),
  ('Wrathbound Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":104,"dexterity":16}'::jsonb, 100, 'twin-soul'),
  ('Shadowstrike Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":112,"dexterity":17}'::jsonb, 105, 'twin-soul'),
  ('Vengeance Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":121,"dexterity":18}'::jsonb, 110, 'twin-soul'),
  ('Warbringer Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":129,"dexterity":19}'::jsonb, 115, 'twin-soul'),
  ('Astral Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":138,"dexterity":21}'::jsonb, 120, 'twin-soul'),
  ('Astral Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":140,"dexterity":21}'::jsonb, 121, 'twin-soul'),
  ('Astral Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":142,"dexterity":21}'::jsonb, 122, 'twin-soul'),
  ('Astral Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":144,"dexterity":22}'::jsonb, 123, 'twin-soul'),
  ('Astral Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":146,"dexterity":22}'::jsonb, 124, 'twin-soul'),
  ('Celestial Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":148,"dexterity":22}'::jsonb, 125, 'twin-soul'),
  ('Celestial Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":150,"dexterity":23}'::jsonb, 126, 'twin-soul'),
  ('Celestial Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":152,"dexterity":23}'::jsonb, 127, 'twin-soul'),
  ('Celestial Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":154,"dexterity":23}'::jsonb, 128, 'twin-soul'),
  ('Celestial Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":155,"dexterity":23}'::jsonb, 129, 'twin-soul'),
  ('Eternity Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":157,"dexterity":24}'::jsonb, 130, 'twin-soul');

commit;
