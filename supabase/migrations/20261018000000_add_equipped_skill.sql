-- First active-skill system column (see src/game/skills/skillData.ts) — a
-- plain session/cosmetic-tier client-writable pointer, same trust model as
-- current_zone/selected_monster_id (column-level grant only, see
-- 20260821000000_lock_down_direct_table_writes.sql): resolve-combat
-- re-validates class + level match before ever using it for real combat
-- math, never trusts the stored value at face value. No FK/CHECK against a
-- skill catalog table since skills are a client-side constant, not a DB
-- table, matching the existing selected_monster_id precedent.
begin;

alter table public.characters add column equipped_skill_id text null;

grant update (equipped_skill_id) on public.characters to authenticated;

commit;
