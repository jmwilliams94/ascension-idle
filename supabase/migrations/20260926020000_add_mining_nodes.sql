-- Mining mechanic, step 1 continued — server-side mirror of the client's
-- src/game/mining/mineData.ts (same relationship enemy_types has to
-- zoneData.ts's ENEMY_TYPES — regenerate this insert if mineData.ts's node
-- stats ever change). 4 mines, one node each. gem_pool is the subset of the
-- 4 currently-coded gem types (drake/ember/bastion/iris) that can drop at
-- that node — the other 4 designed gem types (rage/orchid/kirin/crescent)
-- have no data-layer code yet, so "4th mine = all gems" here means all 4
-- coded ones, not all 8 designed ones.
--
-- No incoming-damage/EXP fields (unlike enemy_types) — a mining node is
-- inanimate: no dodge, no attack-back, no player HP risk, no EXP reward.
-- max_hp/defense are placeholder balance numbers, sized so early mines clear
-- efficiently on early pickaxes and the 4th mine's node needs a heavily-
-- composed Ascended pickaxe (not a bare one) to one-shot.
begin;

create table if not exists public.mining_nodes (
  id text primary key,
  display_name text not null,
  mine_id text not null,
  max_hp integer not null,
  defense integer not null,
  gem_pool text[] not null default '{}'
);

alter table public.mining_nodes enable row level security;

do $$ begin
  create policy "Anyone can view mining nodes"
    on public.mining_nodes for select
    using (true);
exception when duplicate_object then null;
end $$;

grant select on public.mining_nodes to anon, authenticated, service_role;

insert into public.mining_nodes (id, display_name, mine_id, max_hp, defense, gem_pool) values
  ('iron-vein', 'Iron Vein', 'windhollow', 300, 10, array['iris', 'ember']),
  ('cinder-vein', 'Cinder Vein', 'cinderleaf', 500, 30, array['ember', 'bastion']),
  ('storm-vein', 'Storm Vein', 'stormvale', 800, 60, array['drake', 'bastion']),
  ('sunscar-vein', 'Sunscar Vein', 'sunscar-wastes', 1200, 100, array['drake', 'ember', 'bastion', 'iris'])
on conflict (id) do nothing;

commit;
