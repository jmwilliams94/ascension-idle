-- Adds a level 5 and level 10 entry to every 1-handed weapon chain
-- (Club/Sword/Blade), the 2-handed Maul, and Backsword -- per the user, all
-- weapon chains should have a starter tier at 5 and 10, matching the real
-- source data's own pattern for Sword/Blade/Backsword (reference/conquer-
-- items/{swords,blades,backswords}.md all start at level 5 then 10 before
-- 15), applied consistently to Club and Maul too even though their own
-- source data starts at 15 (this game's own pacing choice, not a literal
-- copy -- same 'reference for pacing only' precedent as everywhere else in
-- this catalog).
--
-- Implementation: the existing level-8 row (name + stats already correct
-- for a 'second tier' slot, sitting cleanly below each family's level-15
-- value) just moves to level 10 unchanged. A brand-new level-5 row is
-- inserted with a fresh name (one new word per weapon type -- Sprout/Knot/
-- Page/Nick/Pebble, none colliding with the 194-word rename pass) and a
-- fresh stat value below the (moved) level-10 value, keeping the same
-- round(bowBaseline * family multiplier) methodology as
-- 20260913000000_rescale_weapon_curves.sql.
--
-- Off-hand chains (club-offhand-twinsoul/etc.) and the Twin-soul/Juggernaut
-- duplicate chains (club-twinsoul vs club-juggernaut) all get the identical
-- treatment, same as every other change to these shared weapon pools.
begin;

  -- backsword
  update public.item_templates set required_level = 10 where item_family = 'backsword' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Sprout Backsword', 'weapon', 'backsword', '{"magic_attack":2,"dexterity":1}'::jsonb, 5, 'wuxia');

  -- club-twinsoul
  update public.item_templates set required_level = 10 where item_family = 'club-twinsoul' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Knot Club', 'weapon', 'club-twinsoul', '{"physical_attack":6,"dexterity":1}'::jsonb, 5, 'twin-soul');

  -- club-juggernaut
  update public.item_templates set required_level = 10 where item_family = 'club-juggernaut' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Knot Club', 'weapon', 'club-juggernaut', '{"physical_attack":6,"dexterity":1}'::jsonb, 5, 'juggernaut');

  -- club-offhand-twinsoul
  update public.item_templates set required_level = 10 where item_family = 'club-offhand-twinsoul' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Knot Club', 'quiver', 'club-offhand-twinsoul', '{"physical_attack":6,"dexterity":1}'::jsonb, 5, 'twin-soul');

  -- longsword-twinsoul
  update public.item_templates set required_level = 10 where item_family = 'longsword-twinsoul' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Page Sword', 'weapon', 'longsword-twinsoul', '{"physical_attack":4,"dexterity":1}'::jsonb, 5, 'twin-soul');

  -- longsword-juggernaut
  update public.item_templates set required_level = 10 where item_family = 'longsword-juggernaut' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Page Sword', 'weapon', 'longsword-juggernaut', '{"physical_attack":4,"dexterity":1}'::jsonb, 5, 'juggernaut');

  -- longsword-offhand-twinsoul
  update public.item_templates set required_level = 10 where item_family = 'longsword-offhand-twinsoul' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Page Sword', 'quiver', 'longsword-offhand-twinsoul', '{"physical_attack":4,"dexterity":1}'::jsonb, 5, 'twin-soul');

  -- blade-twinsoul
  update public.item_templates set required_level = 10 where item_family = 'blade-twinsoul' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Nick Blade', 'weapon', 'blade-twinsoul', '{"physical_attack":5,"dexterity":1}'::jsonb, 5, 'twin-soul');

  -- blade-juggernaut
  update public.item_templates set required_level = 10 where item_family = 'blade-juggernaut' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Nick Blade', 'weapon', 'blade-juggernaut', '{"physical_attack":5,"dexterity":1}'::jsonb, 5, 'juggernaut');

  -- blade-offhand-twinsoul
  update public.item_templates set required_level = 10 where item_family = 'blade-offhand-twinsoul' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Nick Blade', 'quiver', 'blade-offhand-twinsoul', '{"physical_attack":5,"dexterity":1}'::jsonb, 5, 'twin-soul');

  -- greatmaul
  update public.item_templates set required_level = 10 where item_family = 'greatmaul' and required_level = 8;
  insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class) values ('Pebble Maul', 'weapon', 'greatmaul', '{"physical_attack":6,"dexterity":1}'::jsonb, 5, 'juggernaut');


commit;
