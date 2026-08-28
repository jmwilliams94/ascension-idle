-- Fixes a third gap in 20261101000000_recompound_weapon_curves.sql: the
-- `wand` item_family (Juggernaut's exclusive "Maul" two-hander, internally
-- still keyed 'wand' from the source data it was reflavored from -- see
-- CLAUDE.accounts-and-classes.md's New-class gear catalog section) was
-- missed entirely -- it isn't one of Twin-soul's Club/Longsword/Blade pool
-- Juggernaut also shares, it's Juggernaut-only, and wasn't in the family
-- list checked when writing 20261101000000. Re-derived here the exact same
-- way as the other 6 ratio-derived families: new Bow curve × the preserved
-- ratio from 20260913000000_rescale_weapon_curves.sql (Maul/wand ×1.1611),
-- required_level=10 kept at the old level-8-derived value (same "stats
-- already sat correctly" precedent as every sibling family), required_level
-- 5 computed via the same one-step extrapolation below Bow's own level-8
-- anchor. Dexterity re-derived via the standard round(atk * 0.15), floored
-- at 1, rule.
begin;

update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '7'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'wand' and required_level = 5;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'wand' and required_level = 10;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'wand' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '10'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'wand' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '13'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'wand' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '14'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'wand' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '16'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'wand' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '19'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'wand' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '21'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'wand' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '23'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'wand' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '27'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'wand' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '30'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'wand' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '35'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'wand' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '39'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'wand' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '44'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'wand' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '51'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'wand' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '58'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'wand' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '65'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'wand' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '74'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'wand' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '85'::jsonb), '{dexterity}', '13'::jsonb) where item_family = 'wand' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '96'::jsonb), '{dexterity}', '14'::jsonb) where item_family = 'wand' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '109'::jsonb), '{dexterity}', '16'::jsonb) where item_family = 'wand' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '124'::jsonb), '{dexterity}', '19'::jsonb) where item_family = 'wand' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '140'::jsonb), '{dexterity}', '21'::jsonb) where item_family = 'wand' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '144'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'wand' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '147'::jsonb), '{dexterity}', '22'::jsonb) where item_family = 'wand' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '152'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'wand' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '156'::jsonb), '{dexterity}', '23'::jsonb) where item_family = 'wand' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '159'::jsonb), '{dexterity}', '24'::jsonb) where item_family = 'wand' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '164'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'wand' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '168'::jsonb), '{dexterity}', '25'::jsonb) where item_family = 'wand' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '172'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'wand' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '176'::jsonb), '{dexterity}', '26'::jsonb) where item_family = 'wand' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{physical_attack}', '181'::jsonb), '{dexterity}', '27'::jsonb) where item_family = 'wand' and required_level = 130;

commit;
