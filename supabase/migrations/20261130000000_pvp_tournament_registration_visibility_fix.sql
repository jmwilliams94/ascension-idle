-- Fix: the previous migration's RLS policy queried
-- pvp_tournament_registrations from inside its own USING clause, which
-- Postgres detects as infinite recursion (evaluating visibility for one row
-- requires re-evaluating RLS on the same table to answer the subquery, which
-- requires re-evaluating RLS again...) -- confirmed live: every select on
-- this table started failing with "infinite recursion detected in policy
-- for relation pvp_tournament_registrations" (42P17), caught immediately
-- while testing the previous migration, before it ever reached a real
-- player. Standard fix (Supabase's own documented pattern for this exact
-- shape): move the self-referencing check into a SECURITY DEFINER function
-- -- it runs as the function owner, who bypasses RLS on tables they own, so
-- the inner query no longer re-triggers the calling policy.
begin;

create or replace function public.pvp_is_registered_for_tournament(p_tournament_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.pvp_tournament_registrations r
    join public.characters c on c.id = r.character_id
    where r.tournament_id = p_tournament_id
      and c.account_id = auth.uid()
  );
$$;

revoke all on function public.pvp_is_registered_for_tournament(uuid) from public;
grant execute on function public.pvp_is_registered_for_tournament(uuid) to authenticated;

drop policy if exists "PvP tournament registrations visible only once you've registered" on public.pvp_tournament_registrations;

create policy "PvP tournament registrations visible only once you've registered"
  on public.pvp_tournament_registrations for select
  using (public.pvp_is_registered_for_tournament(tournament_id));

commit;
