-- Corrects 17 item_templates.name values across the Club/Sword/Wand weapon
-- chains that drifted out of sync after 20260917000000_conquer_synonym_
-- weapon_names.sql. A later design pass (2026-08-23) renamed these specific
-- tiers directly in the "New Class Armory" art-prompt artifact (which is the
-- source of truth for these names) but that rename was never migrated back
-- to the DB -- this migration catches the DB up. Blade needed no changes;
-- it was already in sync with the artifact.
begin;

-- Club
update public.item_templates set name = case
  when required_level = 15 then 'Rivet Club'
  when required_level = 40 then 'Ferrule Club'
  when required_level = 50 then 'Warworn Club'
  when required_level = 100 then 'Thunderhead Club'
  when required_level = 105 then 'Voltaic Club'
  when required_level = 110 then 'Galeforge Club'
  when required_level = 115 then 'Maelstrom Club'
  when required_level between 125 and 129 then 'Squall Club'
  when required_level = 130 then 'Sovereign Club'
  else name end
where item_family in ('club-juggernaut', 'club-twinsoul', 'club-offhand-twinsoul')
  and (required_level in (15, 40, 50, 100, 105, 110, 115, 130) or required_level between 125 and 129);

-- Sword
update public.item_templates set name = case
  when required_level = 95 then 'Oath Sword'
  when required_level = 100 then 'Creed Sword'
  when required_level = 105 then 'Sunray Sword'
  when required_level = 110 then 'Lucent Sword'
  when required_level = 115 then 'Umbra Sword'
  else name end
where item_family in ('longsword-juggernaut', 'longsword-twinsoul', 'longsword-offhand-twinsoul')
  and required_level in (95, 100, 105, 110, 115);

-- Wand
update public.item_templates set name = case
  when required_level = 110 then 'Colossus Wand'
  when required_level = 115 then 'Cairn Wand'
  when required_level = 130 then 'Monarch Wand'
  else name end
where item_family = 'wand'
  and required_level in (110, 115, 130);

commit;
