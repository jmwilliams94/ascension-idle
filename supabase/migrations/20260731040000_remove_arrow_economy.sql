-- Remove the arrow economy entirely (confirmed with the user, 2026-07-31) --
-- a Hunter can now attack as long as the Quiver item is equipped
-- (characters.equipped_quiver_id), full stop. No more ammo stacks, no
-- purchasing, no per-attack consumption. Safe outright removal: the only FK
-- that ever pointed at this table (characters.equipped_arrow_stack_id) was
-- already dropped in the prior Quiver migration (20260731020000_add_quiver.sql).
drop table if exists public.arrow_stacks cascade;
