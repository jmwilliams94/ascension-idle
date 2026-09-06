-- One-time compensation for 20261217000000_remove_cap_tiers_above_120.sql:
-- that migration deleted Wuxard's equipped Heavensent Cap (required_level
-- 126) without first recording the instance's own quality/composition/
-- sockets, only its template name. The user confirmed the exact loadout
-- from memory: Ascended quality, +7 composition, 2 sockets both Ascended
-- Ember Gems. Grants a matching Skysworn Cap (the level-120 tier Heavensent
-- Cap's own chain now tops out at) with that same loadout, full durability,
-- and re-equips it in the same hat slot.
begin;

with new_cap as (
  insert into public.item_instances (template_id, owner_id, quality_tier, composition_level, sockets, level, durability)
  select
    it.id,
    c.id,
    'ascended',
    7,
    '["ember_ascended", "ember_ascended"]'::jsonb,
    it.required_level,
    coalesce(public.compute_max_durability(it.slot_type, it.required_level), 0)
  from public.item_templates it, public.characters c
  where it.name = 'Skysworn Cap' and c.id = 'a5543555-9f65-499d-a053-066b6a17dbd7'
  returning id, owner_id
)
update public.characters c
set equipped_hat_id = new_cap.id
from new_cap
where c.id = new_cap.owner_id;

commit;
