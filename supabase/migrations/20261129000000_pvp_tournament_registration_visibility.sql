-- Anti-sniping (2026-08-31, requested by the user): the registration ladder
-- should be invisible to anyone whose account has no character registered
-- in that tournament yet -- otherwise a player could sit and watch who's
-- entered (and who they'd likely be paired against) before deciding
-- whether to register themselves. Once ANY of your characters is
-- registered, the whole ladder opens up to you (checked at the account
-- level, not per-character -- "no matter what class is viewing", per the
-- user's own framing: switching to a different character on the same
-- account you already registered with shouldn't re-hide it).
--
-- The bracket (pvp_tournament_matches) is deliberately NOT touched here --
-- pairings are only ever visible once the event has gone live, at which
-- point registration is already closed and there's nothing left to snipe;
-- being able to spectate a live bracket is the intended "everyone can watch"
-- experience.
begin;

drop policy if exists "PvP tournament registrations are publicly viewable" on public.pvp_tournament_registrations;

create policy "PvP tournament registrations visible only once you've registered"
  on public.pvp_tournament_registrations for select
  using (
    exists (
      select 1
      from public.pvp_tournament_registrations r2
      join public.characters c on c.id = r2.character_id
      where r2.tournament_id = pvp_tournament_registrations.tournament_id
        and c.account_id = auth.uid()
    )
  );

commit;
