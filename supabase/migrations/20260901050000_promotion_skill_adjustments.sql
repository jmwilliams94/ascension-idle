-- Skill flavor-text adjustments (requested by the user) — skills_unlocked
-- remains purely inert (no ability system exists yet). Swift Volley moves
-- from tier 15 to tier 40, renamed Multi-Shot; Storm Volley + Arrow Tempest
-- (tier 70) are replaced by a single skill, Rapid.
begin;

update public.promotion_tiers set
  skills_unlocked = array[]::text[]
where class = 'hunter' and level = 15;

update public.promotion_tiers set
  skills_unlocked = array['Multi-Shot']
where class = 'hunter' and level = 40;

update public.promotion_tiers set
  skills_unlocked = array['Rapid']
where class = 'hunter' and level = 70;

commit;
