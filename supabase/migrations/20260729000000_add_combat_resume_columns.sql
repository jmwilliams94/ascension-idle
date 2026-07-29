-- Supports the Melvor-idle combat pivot: which monster the character was last
-- fighting (so the Combat page and the offline-progress simulator know what to
-- resume), and when they were last active (so offline-progress can compute how
-- much real-world time has elapsed since their last save).
--
-- Both are client-authoritative fields, same trust model as class/current_zone/
-- gold — written via the existing saveNow() path, not a SECURITY DEFINER RPC.
-- No RLS/grant changes needed: the existing row-level policies and grants on
-- public.characters already cover new columns on the same table.
begin;

alter table public.characters
  add column if not exists selected_monster_id text,
  add column if not exists last_active_at timestamptz not null default now();

commit;
