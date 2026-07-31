-- Hunter Quiver: a genuine 3-slot ammo container filling the paper doll's
-- previously-locked Off-hand/Shield slot for Hunters specifically (see
-- CLAUDE.md's Equipment/Hero page note). Replaces the single "equipped arrow
-- stack" model outright — arrow_stacks.quiver_slot (0/1/2) now tracks which of
-- the 3 quiver slots (if any) a stack occupies; combat auto-consumes from
-- them in slot order, one stack at a time (see useArrowStore.consumeArrow /
-- resolve-combat). No stat bonuses and no upgrade chain yet — just the base
-- container (item_family is seeded for future-proofing only).
begin;

alter table public.characters
  add column if not exists equipped_quiver_id uuid references public.item_instances (id) on delete set null;

alter table public.characters drop column if exists equipped_arrow_stack_id;

alter table public.arrow_stacks
  add column if not exists quiver_slot integer check (quiver_slot in (0, 1, 2));

create unique index if not exists arrow_stacks_one_stack_per_quiver_slot
  on public.arrow_stacks (character_id, quiver_slot)
  where quiver_slot is not null;

insert into public.item_templates (name, slot_type, item_family, required_class, required_level, base_stats, price)
select 'Hunter''s Quiver', 'quiver', 'quiver', 'hunter', 1, '{}'::jsonb, 40
where not exists (select 1 from public.item_templates where name = 'Hunter''s Quiver');

commit;
