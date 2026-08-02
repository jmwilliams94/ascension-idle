-- Coats were missing a second stat the whole time. The real reference data
-- (reference/conquer-items/archer-coats.md, local-only, not shipped) shows
-- every Conquer coat carries both Defense and a "Magic Def (+%)" column --
-- the original gear catalog (20260730000000_add_gear_catalog.sql) only ever
-- captured Defense, dropping Magic Def entirely. Caught when the user asked
-- to double-check the reference data against what shipped.
--
-- Not a literal copy of the source's Magic Def numbers -- same "study the
-- reference for pacing, invent our own values" methodology already used for
-- every other stat in this catalog (the source's own numbers are internally
-- noisy here too, e.g. Fox Coat's Magic Def of 40 exceeds its own Defense of
-- 20 -- not a curve worth copying directly). magic_defense here is simply
-- physical_defense * 0.5 (rounded), giving Coats a modest secondary stat
-- that scales with the same curve as their primary one.
--
-- Inert for now, same as magic_attack: no monster deals magic damage yet, so
-- this has no combat effect until that exists -- it just displays (Coat
-- tooltips, Stats panel) ahead of the mechanic, per this project's established
-- "data exists ahead of the mechanic" precedent (sockets/enchant/dodge all
-- did the same before their own mechanics landed).
begin;

update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 5)
  where item_family = 'coat' and name = 'Fawnhide Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 9)
  where item_family = 'coat' and name = 'Vixen Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 15)
  where item_family = 'coat' and name = 'Timberwolf Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 22)
  where item_family = 'coat' and name = 'Dappled Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 27)
  where item_family = 'coat' and name = 'Silverback Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 32)
  where item_family = 'coat' and name = 'Quilted Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 38)
  where item_family = 'coat' and name = 'Finscale Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 44)
  where item_family = 'coat' and name = 'Hidebound Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 51)
  where item_family = 'coat' and name = 'Skyfeather Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 54)
  where item_family = 'coat' and name = 'Wyrmhide Coat';
update public.item_templates set base_stats = base_stats || jsonb_build_object('magic_defense', 60)
  where item_family = 'coat' and name = 'Emberplate Coat';

commit;
