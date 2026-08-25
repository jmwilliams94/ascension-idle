-- Renames the Level 122 Bracelet from 'Radiant Bracelet' to 'Luminous
-- Bracelet' -- 'Radiant' collides with the quality_tier value of the same
-- name, which would otherwise display as "Radiant Radiant Bracelet" on a
-- radiant-tier instance of this item. Also updated in the New Class Armory
-- art-prompt artifact (source of truth for these names).
begin;

update public.item_templates
set name = 'Luminous Bracelet'
where item_family = 'bracelet'
  and required_level = 122
  and name = 'Radiant Bracelet';

commit;
