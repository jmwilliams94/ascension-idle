-- Extends the players table (see 20260727000000_add_players_table.sql) with real
-- game-state columns so progress survives a refresh: class, level, gold, EXP, and
-- current zone. Existing RLS policies already cover the whole row via
-- auth.uid() = id, so no new policies are needed for these columns.
alter table public.players
  add column if not exists class text,
  add column if not exists level integer not null default 1,
  add column if not exists gold integer not null default 0,
  add column if not exists exp integer not null default 0,
  add column if not exists current_zone text not null default 'Twincross Outskirts';
