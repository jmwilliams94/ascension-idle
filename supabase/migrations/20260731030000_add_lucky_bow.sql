-- Hunter's real starting weapon (confirmed with the user, 2026-07-31) --
-- previously Hunters had no bow at all until they saved up for the real Bow
-- chain's cheapest item (Sapling Bow, level 8, 35g) or bought the generic
-- class-agnostic "Wooden Sword" (not a bow at all). Lucky Bow matches the
-- Wooden Sword's stats/price exactly (physical_attack 5, 25g) but is
-- Hunter-only and auto-granted at character creation, mirroring the Quiver's
-- own starter-grant precedent (see useCharacterRosterStore.ts). Standalone
-- item_family (not 'bow') so it's never treated as part of the real Bow
-- chain's Level Upgrade progression, matching how Wooden Sword's own
-- 'sword' family is kept separate for the same reason.
insert into public.item_templates (name, slot_type, item_family, required_class, required_level, base_stats, price)
select 'Lucky Bow', 'weapon', 'lucky-bow', 'hunter', 1, '{"physical_attack": 5}'::jsonb, 25
where not exists (select 1 from public.item_templates where name = 'Lucky Bow');
