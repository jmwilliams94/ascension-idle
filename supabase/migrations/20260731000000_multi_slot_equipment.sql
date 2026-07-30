-- Multi-slot equipping (confirmed with the user, 2026-07-31) — only Main Hand
-- has ever been a functional equip slot; Ring/Necklace/Boots/Hat/Coat become
-- real now too, matching the 6 slot_types that actually have catalog data.
--
-- Renamed equipped_item_id -> equipped_weapon_id first: the old name becomes
-- ambiguous once 5 siblings exist. Plain rename, no data loss.
alter table public.characters rename column equipped_item_id to equipped_weapon_id;

-- Each mirrors equipped_weapon_id's own FK exactly, so selling/deleting an
-- equipped item cleanly clears the slot (on delete set null) instead of
-- leaving a dangling reference.
alter table public.characters
  add column if not exists equipped_ring_id uuid references public.item_instances (id) on delete set null,
  add column if not exists equipped_necklace_id uuid references public.item_instances (id) on delete set null,
  add column if not exists equipped_boots_id uuid references public.item_instances (id) on delete set null,
  add column if not exists equipped_hat_id uuid references public.item_instances (id) on delete set null,
  add column if not exists equipped_coat_id uuid references public.item_instances (id) on delete set null;
