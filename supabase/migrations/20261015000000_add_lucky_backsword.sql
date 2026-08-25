-- Adds a Level 1 "Lucky Backsword" starter, mirroring Blade's own Level 1
-- Fortune Blade precedent (20260917000000_conquer_synonym_weapon_names.sql)
-- -- Backsword is the second weapon category to get a sub-5 starter tier.
-- Stats scaled off Plum Backsword (Lv5: magic_attack 2, dexterity 1) using
-- the exact same ratio Fortune Blade (Lv1) used against Bronze Blade (Lv5):
-- dexterity unchanged, attack stat ~40% (round(2 * 2/5) = 1).
begin;

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class)
values ('Lucky Backsword', 'weapon', 'backsword', '{"dexterity":1,"magic_attack":1}'::jsonb, 1, 'wuxia');

commit;
