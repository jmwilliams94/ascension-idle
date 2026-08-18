-- Fixes a mis-mapped reference column from the previous rescale
-- (20260913000000_rescale_weapon_curves.sql). Backsword's source data
-- (reference/conquer-items/backswords.md) has THREE numeric weapon columns:
-- Max Atk, Min Atk, and Magic Atk -- the previous pass scaled Backsword's
-- multiplier off Max Atk (822 at level 130, the physical/Strength-scaled
-- column, irrelevant for a 0-Str Wuxia), instead of the actual Magic Atk
-- column (1167 at level 130 Normal tier / 1330 at Super) -- the one that
-- corresponds to our own magic_attack stat. Corrected multiplier:
-- 1167/2558 = 0.4562 (was 822/2558 = 0.3213). Same methodology otherwise --
-- applied across Bow's own 33 level breakpoints, dexterity re-derived from
-- the new magic_attack value via round(atk*0.15), floored at 1.
begin;

update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '3'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 8;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '5'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 15;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '6'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 20;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '8'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 25;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '9'::jsonb), '{dexterity}', '1'::jsonb) where item_family = 'backsword' and required_level = 30;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '11'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 35;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '13'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 40;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '15'::jsonb), '{dexterity}', '2'::jsonb) where item_family = 'backsword' and required_level = 45;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '17'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 50;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '20'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 55;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '22'::jsonb), '{dexterity}', '3'::jsonb) where item_family = 'backsword' and required_level = 60;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '25'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'backsword' and required_level = 65;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '27'::jsonb), '{dexterity}', '4'::jsonb) where item_family = 'backsword' and required_level = 70;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '31'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 75;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '33'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 80;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '36'::jsonb), '{dexterity}', '5'::jsonb) where item_family = 'backsword' and required_level = 85;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '40'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 90;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '43'::jsonb), '{dexterity}', '6'::jsonb) where item_family = 'backsword' and required_level = 95;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '47'::jsonb), '{dexterity}', '7'::jsonb) where item_family = 'backsword' and required_level = 100;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '51'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'backsword' and required_level = 105;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '55'::jsonb), '{dexterity}', '8'::jsonb) where item_family = 'backsword' and required_level = 110;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '58'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'backsword' and required_level = 115;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '63'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'backsword' and required_level = 120;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '63'::jsonb), '{dexterity}', '9'::jsonb) where item_family = 'backsword' and required_level = 121;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '64'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'backsword' and required_level = 122;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '65'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'backsword' and required_level = 123;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '66'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'backsword' and required_level = 124;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '67'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'backsword' and required_level = 125;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '68'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'backsword' and required_level = 126;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '69'::jsonb), '{dexterity}', '10'::jsonb) where item_family = 'backsword' and required_level = 127;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '70'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'backsword' and required_level = 128;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '70'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'backsword' and required_level = 129;
update public.item_templates set base_stats = jsonb_set(jsonb_set(base_stats, '{magic_attack}', '71'::jsonb), '{dexterity}', '11'::jsonb) where item_family = 'backsword' and required_level = 130;

commit;
