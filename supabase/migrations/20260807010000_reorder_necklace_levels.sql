-- Reorder the bottom of the Necklace family's level chain per the user's
-- request: Twine Necklace becomes the lowest tier (level 7), Wisp second
-- (17), Locket third (27) -- was Wisp=7 / Locket=17 / Twine=27. Pure
-- reshuffle of which name sits at which level: the *set* of required_level
-- values in the necklace family is unchanged, so level_upgrade's
-- next-higher-required_level-in-family lookup still walks the same chain
-- positions, just with different names attached. Emerald/Quartz (37/45)
-- and everything above are untouched.
update item_templates set required_level = 7 where name = 'Twine Necklace' and slot_type = 'necklace';
update item_templates set required_level = 17 where name = 'Wisp Necklace' and slot_type = 'necklace';
update item_templates set required_level = 27 where name = 'Locket Necklace' and slot_type = 'necklace';

-- Re-sync any already-granted instance's cached `level` field to match its
-- template's new required_level -- same correction precedent as the Hunter
-- armor level-120 cap migration (20260730080000).
update item_instances ii
set level = it.required_level
from item_templates it
where ii.template_id = it.id
  and it.slot_type = 'necklace'
  and it.name in ('Twine Necklace', 'Wisp Necklace', 'Locket Necklace')
  and ii.level <> it.required_level;
