-- Reshapes Bow's physical_attack curve from its old front-loaded/tapering
-- growth (fast early, nearly flat by level 120-130) into smooth compounding
-- growth (~2.577%/level), pinned at today's level-8 (7) and level-130 (156)
-- values so the starter and endgame numbers don't jump. Requested by the
-- user: gear was barely mattering relative to automatic level-up strength
-- growth (a 20-level-stale weapon only cost ~13% total damage), and a
-- tapering curve meant that gap shrank even further at high level, backwards
-- from "upgrading should matter." A pure compounding curve makes the % cost
-- of stale gear consistent (and larger) at every level instead.
--
-- Ring is reshaped the same way (its own natural rate, ~3.128%/level,
-- pinned at level-1=2 / level-126=94 -- Ring has no level-130 entry).
--
-- Club/Longsword/Blade/Backsword are re-derived off the NEW Bow curve using
-- the exact same preserved ratios from the 20260913_rescale_weapon_curves
-- migration (club x1.2224, longsword x0.8679, blade x1.0066, backsword
-- x0.3213 on magic_attack) -- so their relative power to Bow is unchanged,
-- only the shape of the underlying curve moves. Dexterity is re-derived from
-- each new value via the existing round(atk * 0.15), floored at 1, rule.
--
-- Paired with 20261102000000_rebalance_enemy_hp.sql, which re-derives every
-- monster's max_hp against this new curve (Infused quality, level-matched
-- gear, +0 composition, no gems => ~6 hits vs a same-level monster). Doing
-- one without the other would break the intended pacing.
--
-- Retroactive: item_templates stats are read live by computeEquipmentBonus
-- at combat/tooltip time, not baked into item_instances at drop time, so
-- this rebalances every already-owned Bow/Ring/Club/Sword/Blade/Backsword
-- instantly on deploy, not just future drops -- confirmed with the user.
begin;

-- Bow (baseline curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'bow' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'bow' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'bow' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'bow' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'bow' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'bow' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'bow' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '18'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'bow' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'bow' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'bow' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '26'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'bow' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '30'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'bow' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '34'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'bow' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'bow' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '44'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'bow' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '50'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'bow' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '56'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'bow' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '64'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'bow' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '73'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'bow' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '83'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'bow' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '94'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'bow' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '107'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'bow' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '121'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'bow' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '124'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'bow' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '127'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'bow' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '131'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'bow' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '134'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'bow' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '137'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'bow' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '141'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'bow' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '145'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'bow' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '148'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'bow' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '152'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'bow' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '156'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'bow' and required_level = 130;

-- Lucky Bow (standalone starter, same formula precedent as the original dexterity migration) -- unchanged, not part of the Bow chain's Level Upgrade progression, left as-is

-- Ring (baseline curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '2'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'ring' and required_level = 1;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '3'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'ring' and required_level = 10;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '4'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'ring' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '5'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'ring' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'ring' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'ring' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'ring' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'ring' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'ring' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '31'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'ring' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '42'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'ring' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '57'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'ring' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '69'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'ring' and required_level = 116;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '81'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'ring' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '94'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'ring' and required_level = 126;

-- backsword (x0.3213, re-derived off new Bow curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '2'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '3'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '3'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '4'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '4'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '4'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '5'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '18'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '21'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '27'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'backsword' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '30'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '34'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '39'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '40'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '41'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '42'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '44'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '45'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '47'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '48'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '50'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'backsword' and required_level = 130;

-- club-twinsoul (x1.2224, re-derived off new Bow curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'club-twinsoul' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-twinsoul' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-twinsoul' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '13'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-twinsoul' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '15'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-twinsoul' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-twinsoul' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-twinsoul' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '22'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-twinsoul' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '24'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-twinsoul' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '28'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-twinsoul' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '32'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'club-twinsoul' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '37'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'club-twinsoul' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '42'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'club-twinsoul' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '46'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'club-twinsoul' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '54'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'club-twinsoul' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '61'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'club-twinsoul' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '68'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'club-twinsoul' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '78'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'club-twinsoul' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'club-twinsoul' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '101'::jsonb), '{dexterity}', '15'::jsonb) where item_family = 'club-twinsoul' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '115'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'club-twinsoul' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '131'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'club-twinsoul' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '148'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'club-twinsoul' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '152'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'club-twinsoul' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '155'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'club-twinsoul' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '160'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'club-twinsoul' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '164'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'club-twinsoul' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '167'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'club-twinsoul' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '172'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-twinsoul' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '177'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-twinsoul' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '181'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-twinsoul' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '186'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-twinsoul' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '191'::jsonb), '{dexterity}', '29'::jsonb) where item_family = 'club-twinsoul' and required_level = 130;

-- club-juggernaut (x1.2224, re-derived off new Bow curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'club-juggernaut' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-juggernaut' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-juggernaut' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '13'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-juggernaut' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '15'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'club-juggernaut' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-juggernaut' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-juggernaut' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '22'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'club-juggernaut' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '24'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-juggernaut' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '28'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'club-juggernaut' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '32'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'club-juggernaut' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '37'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'club-juggernaut' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '42'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'club-juggernaut' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '46'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'club-juggernaut' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '54'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'club-juggernaut' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '61'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'club-juggernaut' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '68'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'club-juggernaut' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '78'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'club-juggernaut' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '89'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'club-juggernaut' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '101'::jsonb), '{dexterity}', '15'::jsonb) where item_family = 'club-juggernaut' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '115'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'club-juggernaut' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '131'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'club-juggernaut' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '148'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'club-juggernaut' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '152'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'club-juggernaut' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '155'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'club-juggernaut' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '160'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'club-juggernaut' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '164'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'club-juggernaut' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '167'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'club-juggernaut' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '172'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'club-juggernaut' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '177'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-juggernaut' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '181'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'club-juggernaut' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '186'::jsonb), '{dexterity}', '28'::jsonb) where item_family = 'club-juggernaut' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '191'::jsonb), '{dexterity}', '29'::jsonb) where item_family = 'club-juggernaut' and required_level = 130;

-- longsword-twinsoul (x0.8679, re-derived off new Bow curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '26'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '30'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '56'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '63'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '72'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '82'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '93'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '105'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '108'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '110'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '114'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '116'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '119'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '122'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '126'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '128'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '132'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '135'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-twinsoul' and required_level = 130;

-- longsword-juggernaut (x0.8679, re-derived off new Bow curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '26'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '30'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '49'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '56'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '63'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '72'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '82'::jsonb), '{dexterity}', '12'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '93'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '105'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '108'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '110'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '114'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '116'::jsonb), '{dexterity}', '17'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '119'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '122'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '126'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '128'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '132'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '135'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'longsword-juggernaut' and required_level = 130;

-- blade-twinsoul (x1.0066, re-derived off new Bow curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-twinsoul' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-twinsoul' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-twinsoul' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-twinsoul' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-twinsoul' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-twinsoul' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-twinsoul' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '18'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-twinsoul' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-twinsoul' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-twinsoul' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '26'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'blade-twinsoul' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '30'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'blade-twinsoul' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '34'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'blade-twinsoul' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'blade-twinsoul' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '44'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'blade-twinsoul' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '50'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'blade-twinsoul' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '56'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'blade-twinsoul' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '64'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'blade-twinsoul' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '73'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'blade-twinsoul' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '84'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'blade-twinsoul' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '95'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'blade-twinsoul' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '108'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'blade-twinsoul' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '122'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'blade-twinsoul' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '125'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'blade-twinsoul' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '128'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'blade-twinsoul' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '132'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'blade-twinsoul' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '135'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'blade-twinsoul' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '138'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-twinsoul' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '142'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-twinsoul' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '146'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-twinsoul' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '149'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-twinsoul' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '153'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-twinsoul' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '157'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'blade-twinsoul' and required_level = 130;

-- blade-juggernaut (x1.0066, re-derived off new Bow curve)
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-juggernaut' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-juggernaut' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'blade-juggernaut' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-juggernaut' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '12'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-juggernaut' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-juggernaut' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'blade-juggernaut' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '18'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-juggernaut' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-juggernaut' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'blade-juggernaut' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '26'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'blade-juggernaut' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '30'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'blade-juggernaut' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '34'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'blade-juggernaut' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '38'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'blade-juggernaut' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '44'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'blade-juggernaut' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '50'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'blade-juggernaut' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '56'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'blade-juggernaut' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '64'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'blade-juggernaut' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '73'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'blade-juggernaut' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '84'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'blade-juggernaut' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '95'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'blade-juggernaut' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '108'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'blade-juggernaut' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '122'::jsonb), '{dexterity}', '18'::jsonb) where item_family = 'blade-juggernaut' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '125'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'blade-juggernaut' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '128'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'blade-juggernaut' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '132'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'blade-juggernaut' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '135'::jsonb), '{dexterity}', '20'::jsonb) where item_family = 'blade-juggernaut' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '138'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-juggernaut' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '142'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'blade-juggernaut' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '146'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-juggernaut' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '149'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'blade-juggernaut' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '153'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'blade-juggernaut' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '157'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'blade-juggernaut' and required_level = 130;

commit;
