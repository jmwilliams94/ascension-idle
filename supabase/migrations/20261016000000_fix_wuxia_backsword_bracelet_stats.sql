-- Corrects Wuxia's Backsword (weapon) and Bracelet (ring) base_stats against
-- real Conquer Online reference data the user provided: neither item ever
-- carries Dexterity, and Bracelet's attack stat is Magic Attack, not
-- Physical Attack. The original 20260909000000_wuxia_gear_catalog.sql seed
-- mistakenly reused Bow/Ring's dexterity curve and Ring's physical_attack
-- key wholesale, rather than adapting them to Wuxia's actual (Dex-less,
-- Spirit/magic-attack-only) kit -- this migration removes Dexterity from
-- both chains and converts Bracelet's physical_attack to magic_attack
-- (same numeric values, just relabeled -- not re-tuned against the
-- reference numbers yet). Also fixes the same bug on the just-added Lucky
-- Backsword (20261015000000_add_lucky_backsword.sql).
begin;

update public.item_templates
set base_stats = base_stats - 'dexterity'
where item_family = 'backsword';

update public.item_templates
set base_stats = (base_stats - 'dexterity' - 'physical_attack')
  || jsonb_build_object('magic_attack', (base_stats->>'physical_attack')::int)
where item_family = 'bracelet';

commit;
