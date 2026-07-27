-- Basic gear drops (see CLAUDE.md's Gear system section). Deliberately minimal: one
-- plain item type, flat stats, no quality tiers/composition/sockets/enchants yet —
-- but quality_tier/composition_level/sockets/enchant columns exist now so those later
-- steps don't require another schema rework, and this is also where we're
-- front-loading schema for the upcoming item/stat systems generally.
create extension if not exists pgcrypto;

create table if not exists public.item_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slot_type text not null,
  base_stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.item_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.item_templates (id),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Unused this step (see the note above) — inert until quality/composition/sockets
  -- are actually implemented.
  quality_tier text,
  composition_level integer not null default 0,
  sockets jsonb not null default '[]'::jsonb,
  enchant jsonb,
  created_at timestamptz not null default now()
);

alter table public.item_templates enable row level security;
alter table public.item_instances enable row level security;

-- Static reference data — readable by anyone, never written to by players.
create policy "Item templates are readable by anyone"
  on public.item_templates for select
  using (true);

-- Same "own row" pattern as players.
create policy "Players can view their own item instances"
  on public.item_instances for select
  using (auth.uid() = owner_id);

create policy "Players can insert their own item instances"
  on public.item_instances for insert
  with check (auth.uid() = owner_id);

create policy "Players can update their own item instances"
  on public.item_instances for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Single-slot shortcut: only works because there's exactly one equip slot (weapon)
-- right now. Will need to become a multi-slot shape (jsonb map or a separate
-- equipped-items table) once other gear slots exist.
alter table public.players
  add column if not exists equipped_item_id uuid references public.item_instances (id) on delete set null;

-- Seed the single placeholder item — flavor name only, not a finalized gear naming
-- chain (see CLAUDE.md's Gear system section).
insert into public.item_templates (name, slot_type, base_stats)
select 'Wooden Sword', 'weapon', '{"physical_attack": 5}'::jsonb
where not exists (select 1 from public.item_templates where name = 'Wooden Sword');
