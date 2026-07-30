-- Fixes "permission denied for table characters" (and would have hit the same
-- wall on every other table resolve-combat touches) — grepping every prior
-- migration in this project confirms service_role has never once been
-- explicitly granted table access. This is the same gotcha already documented
-- in CLAUDE.md for anon/authenticated (tables created via a raw SQL migration
-- don't get Supabase's dashboard-style auto-grants), just never discovered for
-- service_role until now: every previous privileged operation went through a
-- SECURITY DEFINER SQL function, which runs as the function's owner and never
-- needed a table grant to the calling role at all. resolve-combat's Edge
-- Function is the first thing in this project to run raw service_role-
-- authenticated queries directly against these tables.
--
-- service_role is Supabase's trusted, full-access backend role (also has
-- BYPASSRLS) — granting it everything on these tables matches how it already
-- behaves on any table created through the dashboard, rather than trying to
-- scope it down table-by-table/operation-by-operation the way anon/
-- authenticated grants are deliberately scoped.
grant all on public.characters to service_role;
grant all on public.item_instances to service_role;
grant all on public.item_templates to service_role;
grant all on public.arrow_stacks to service_role;
grant all on public.loot_holding to service_role;
grant all on public.enemy_types to service_role;
