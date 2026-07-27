-- No player-facing persistence exists yet (see CLAUDE.md's Persistence note — the
-- real save system is still to be designed). This migration only adds the minimal
-- players table needed to track which app version each player has last seen, for
-- the "What's New" login notification.
create table if not exists public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  last_seen_version text,
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;

create policy "Players can view their own row"
  on public.players for select
  using (auth.uid() = id);

create policy "Players can insert their own row"
  on public.players for insert
  with check (auth.uid() = id);

create policy "Players can update their own row"
  on public.players for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
