-- Fixes "permission denied for table item_templates" / item_instances
-- (Postgres error 42501). RLS policies only govern row-level access on top of
-- standard table-level GRANTs — creating these tables via raw SQL (rather than the
-- Supabase Table Editor, which auto-grants) never actually gave the anon/
-- authenticated roles table-level privileges, so every request was rejected before
-- RLS was even consulted.
grant select on public.item_templates to anon, authenticated;

-- No update grant: item_instances intentionally has no client-side UPDATE policy
-- (see 20260727030000) and no code calls .update() on it — matching that, only
-- select/insert are granted here.
grant select, insert on public.item_instances to authenticated;
