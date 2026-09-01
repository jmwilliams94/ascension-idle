-- Remove Wooden Sword (requested by the user) -- the class-agnostic
-- starter-freebie weapon (item_family 'sword', a singleton family with no
-- other members) predating every class's own real starter weapon (Hunter's
-- Lucky Bow, Wuxia's Backsword line, Twin-soul/Juggernaut's own catalogs).
-- Already hidden from Hunter's own Shop tab (ShopPanel.tsx) and excluded
-- from monster drops (NON_DROPPABLE_FAMILIES) -- this drops the row and its
-- real instances entirely rather than just hiding it further.
--
-- 15 real item_instances existed (13 in Bank, 2 in Inventory) -- one of the
-- Inventory ones was actually equipped by a live level-1 Wuxia character.
-- Reassign that character's equipped_weapon_id to another weapon they
-- already own before deleting, so they aren't left silently weaponless;
-- falls back to null if a character somehow owns no other weapon.
begin;

update public.characters c
set equipped_weapon_id = (
  select ii2.id
  from public.item_instances ii2
  join public.item_templates it2 on it2.id = ii2.template_id
  where ii2.owner_id = c.id
    and it2.slot_type = 'weapon'
    and it2.name <> 'Wooden Sword'
  order by ii2.created_at
  limit 1
)
where exists (
  select 1
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = c.equipped_weapon_id
    and it.name = 'Wooden Sword'
);

delete from public.item_instances
where template_id in (select id from public.item_templates where name = 'Wooden Sword');

delete from public.item_templates where name = 'Wooden Sword';

commit;
