-- Gem system data-layer scaffolding (see CLAUDE.md's Gem system section).
-- Only 4 of the 8 designed gems (Drake/Ember/Bastion/Iris) have real code
-- behind them yet; this column stores all of them uniformly regardless.
--
-- Storage mirrors composition_stones (fungible per-tier counts, no
-- per-unit item_instances row) per the user's explicit request, keyed flat
-- as "<gem>_<tier>" (e.g. "drake_tempered") rather than nested, so a single
-- jsonb `->>` lookup or `jsonb_set` path covers one counter at a time —
-- same flat-key shape composition_stones already uses (keys "1"-"9").
--
-- Deliberately inert: nothing reads or writes this column yet (no drop
-- source, no Forge socketing, no client save/hydrate plumbing) — same
-- "data exists ahead of the mechanic" pattern already used for sockets/
-- dodge/mana potions before their own mechanics existed.
begin;

alter table public.characters
  add column if not exists gems jsonb not null default '{}'::jsonb;

commit;
