-- Rebalances every monster's max_hp (server mirror of zoneData.ts's
-- EnemyTypeDef, see CLAUDE.md's resolve-combat duplication warning). Old HP
-- was calibrated years-ago-equivalent against the original tapering Bow
-- curve; a well-geared character (Ascended quality + composition + gem
-- sockets) could 2-3 hit content 3-5 levels above them, and even
-- Normal-quality level-matched gear only needed 5-9 hits. New values are
-- solved directly (not a flat multiplier) against the new compounding
-- weapon curve from 20261101000000_recompound_weapon_curves.sql: Infused
-- quality, level-matched gear, +0 composition, no gems => ~6 hits vs a
-- same-level monster (mid of the user's 4-8 target). Validated: Normal
-- quality lands ~9 hits, Ascended ~5, and max realistic BiS (Ascended, +12
-- composition @ 10%/tier, both weapon sockets on Ascended Drake gems) lands
-- flat at ~3 hits across the whole 1-130 range -- the accepted ceiling.
-- goldReward/attackDamage are untouched, only max_hp changes.
begin;

update public.enemy_types set max_hp = 108 where id = 'quailwing';
update public.enemy_types set max_hp = 120 where id = 'mourning-dove';
update public.enemy_types set max_hp = 132 where id = 'redbreast';
update public.enemy_types set max_hp = 162 where id = 'warshade';
update public.enemy_types set max_hp = 168 where id = 'grim-specter';
update public.enemy_types set max_hp = 168 where id = 'wingfang-serpent';
update public.enemy_types set max_hp = 192 where id = 'brushrunner';
update public.enemy_types set max_hp = 198 where id = 'thornreaver';
update public.enemy_types set max_hp = 240 where id = 'woodkin';
update public.enemy_types set max_hp = 258 where id = 'woodkin-sovereign';
update public.enemy_types set max_hp = 273 where id = 'ridgeback-simian';
update public.enemy_types set max_hp = 306 where id = 'boulder-ape';
update public.enemy_types set max_hp = 342 where id = 'bellowing-brute';
update public.enemy_types set max_hp = 393 where id = 'frostpelt';
update public.enemy_types set max_hp = 438 where id = 'venomkin';
update public.enemy_types set max_hp = 438 where id = 'dunecrawler';
update public.enemy_types set max_hp = 528 where id = 'cragbeast';
update public.enemy_types set max_hp = 564 where id = 'boulderback-golem';
update public.enemy_types set max_hp = 666 where id = 'stonewarden';
update public.enemy_types set max_hp = 720 where id = 'edgeborn';
update public.enemy_types set max_hp = 720 where id = 'wingkin';
update public.enemy_types set max_hp = 840 where id = 'wingkin-sovereign';
update public.enemy_types set max_hp = 834 where id = 'hawklord';
update public.enemy_types set max_hp = 912 where id = 'silverwing';
update public.enemy_types set max_hp = 1080 where id = 'footpad';
update public.enemy_types set max_hp = 1092 where id = 'cryptwing';
update public.enemy_types set max_hp = 1194 where id = 'crimson-wing';
update public.enemy_types set max_hp = 1434 where id = 'crimson-sovereign';
update public.enemy_types set max_hp = 1566 where id = 'ironhorn-fiend';
update public.enemy_types set max_hp = 1818 where id = 'verdant-fiend';
update public.enemy_types set max_hp = 1182 where id = 'ratling-flinger';
update public.enemy_types set max_hp = 1188 where id = 'gilded-wraith';
update public.enemy_types set max_hp = 1446 where id = 'swiftgnaw';
update public.enemy_types set max_hp = 1686 where id = 'nightfiend';
update public.enemy_types set max_hp = 1818 where id = 'bullhorn-warden';
update public.enemy_types set max_hp = 1818 where id = 'rime-serpent';
update public.enemy_types set max_hp = 1992 where id = 'serpent-herald';
update public.enemy_types set max_hp = 2046 where id = 'serpent-warden';
update public.enemy_types set max_hp = 2280 where id = 'fiend-sovereign';
update public.enemy_types set max_hp = 2334 where id = 'frostblade-fiend';

commit;
