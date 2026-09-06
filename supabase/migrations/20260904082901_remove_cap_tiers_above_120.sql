-- Removes the Wuxia Cap (hat slot) tiers above required_level 120 --
-- Moonbound Cap (121) and Heavensent Cap (126) -- per the user's explicit
-- request (v1.130.5). Follows the same safe-removal shape as
-- 20261204000000_remove_wooden_sword.sql: reassign any live equipped
-- instance to another owned Cap first (falls back to null if the
-- character owns no other Cap), then delete the instances and finally the
-- templates.
--
-- Only one real instance existed in the whole game: Wuxard's equipped
-- Heavensent Cap (no Moonbound Cap instance existed anywhere). Wuxard owns
-- no other Cap, so their equipped_hat_id falls back to null (unequipped).
begin;

update public.characters c
set equipped_hat_id = (
  select ii2.id
  from public.item_instances ii2
  join public.item_templates it2 on it2.id = ii2.template_id
  where ii2.owner_id = c.id
    and it2.item_family = 'cap'
    and it2.required_level < 121
  order by ii2.created_at
  limit 1
)
where exists (
  select 1
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = c.equipped_hat_id
    and it.item_family = 'cap'
    and it.required_level >= 121
);

delete from public.item_instances
where template_id in (select id from public.item_templates where item_family = 'cap' and required_level >= 121);

delete from public.item_templates where item_family = 'cap' and required_level >= 121;

commit;
