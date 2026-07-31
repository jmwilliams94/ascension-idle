-- Consumable HP/Mana potions (CLAUDE.md's Consumables section). Mirrors the
-- arrow_stacks table exactly: potions are discrete, capped, buyable stack
-- rows, not a flat per-type counter. Manual "Use" only (not auto-consumed
-- during combat), so unlike arrow depletion this table is written to
-- immediately on every change (buy or use), not through the debounced
-- autosave — a potion Use is a deliberate one-off player action, not a
-- per-tick automatic drain.
create table if not exists public.potion_stacks (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  potion_type text not null check (potion_type in (
    'sprigroot_tonic', 'verdant_balm', 'emberleaf_draught', 'ironbark_elixir',
    'stormroot_brew', 'duskflame_panacea', 'skyfire_elixir', 'wyrmheart_draught',
    'mossglow_tonic', 'whisperleaf_draught', 'moonpetal_elixir', 'starlight_brew',
    'emberwind_panacea', 'nightbloom_draught', 'voidglass_elixir', 'astral_draught'
  )),
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now()
);

alter table public.potion_stacks enable row level security;

create policy "Characters can view their own potion stacks"
  on public.potion_stacks for select
  using (exists (select 1 from public.characters c where c.id = potion_stacks.character_id and c.account_id = auth.uid()));

create policy "Characters can insert their own potion stacks"
  on public.potion_stacks for insert
  with check (exists (select 1 from public.characters c where c.id = potion_stacks.character_id and c.account_id = auth.uid()));

create policy "Characters can update their own potion stacks"
  on public.potion_stacks for update
  using (exists (select 1 from public.characters c where c.id = potion_stacks.character_id and c.account_id = auth.uid()))
  with check (exists (select 1 from public.characters c where c.id = potion_stacks.character_id and c.account_id = auth.uid()));

create policy "Characters can delete their own potion stacks"
  on public.potion_stacks for delete
  using (exists (select 1 from public.characters c where c.id = potion_stacks.character_id and c.account_id = auth.uid()));

grant select, insert, update, delete on public.potion_stacks to authenticated;
