-- Fix: resolve_combat_apply_results (the level_130 crossing announcement
-- added in 20260824000000) is a plain (non security definer) function
-- called by the resolve-combat Edge Function's service-role client. Every
-- OTHER writer of global_announcements (quality_upgrade, level_upgrade,
-- master_forge_upgrade, draw_lucky_ticket/_bulk) is security definer, so it
-- writes as the function owner and never needed a grant -- this is the
-- first plain-invoker-rights write this table has ever had. Nobody granted
-- service_role INSERT, so every attempt to cross level 130 hit "permission
-- denied for table global_announcements" on that insert and rolled back the
-- ENTIRE resolve_combat_apply_results call (including the level/exp UPDATE
-- earlier in the same function) -- a deterministic, permanent wall: every
-- retry recomputed the same window and failed the same way, reported by the
-- user as a character stuck just short of 130 across many reopens.
begin;

grant insert on public.global_announcements to service_role;

commit;
