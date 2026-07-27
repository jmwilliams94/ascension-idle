-- Several related changes: starting gold, character names (with global uniqueness
-- and a capital-then-lowercase format), real multi-stack arrow inventory (replacing
-- the flat arrows/equipped_arrow_type columns), and character deletion.
begin;

-- === 1. Starting gold ============================================================
-- Every class now starts with the same placeholder amount. Only affects new
-- characters (existing rows keep their current gold).
alter table public.characters alter column gold set default 5000;

-- === 2. Character names ===========================================================
-- Format: exactly one leading capital letter, then any number of lowercase letters
-- only (matches '^[A-Z][a-z]*$') — enforced both client-side and here. Unique across
-- every account, not just within one.
alter table public.characters add column if not exists name text;

-- Backfill existing (pre-naming) rows with a compliant, unique placeholder before
-- adding NOT NULL/UNIQUE — assumes at most 26 such rows exist (true for this
-- project's current test data); 'Legacy' + a single letter suffix keeps the whole
-- string matching the format (one capital at the very start, lowercase after).
with numbered as (
  select id, row_number() over (order by created_at) as rn
  from public.characters
  where name is null
)
update public.characters c
set name = 'Legacy' || chr((96 + numbered.rn)::int)
from numbered
where c.id = numbered.id;

alter table public.characters alter column name set not null;
alter table public.characters add constraint characters_name_format_check check (name ~ '^[A-Z][a-z]*$');
alter table public.characters add constraint characters_name_unique unique (name);

-- === 3. Character deletion ========================================================
-- characters had no DELETE policy/grant at all before now.
create policy "Accounts can delete their own characters"
  on public.characters for delete
  using (account_id = auth.uid());

grant delete on public.characters to authenticated;

-- === 4. Real multi-stack arrow inventory =========================================
-- Replaces the flat per-character arrows/equipped_arrow_type columns: arrows are now
-- discrete stack rows (like inventory items), each capped at a per-type max when
-- created/topped-up by a purchase (enforced in the client, not a DB constraint,
-- since the caps themselves are placeholders — see CLAUDE.md). Equipping targets a
-- specific stack, not just a type — depleting the equipped stack doesn't touch any
-- other stack of the same type sitting in inventory.
create table if not exists public.arrow_stacks (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  arrow_type text not null check (arrow_type in ('iron', 'lucky', 'speed')),
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now()
);

alter table public.arrow_stacks enable row level security;

create policy "Characters can view their own arrow stacks"
  on public.arrow_stacks for select
  using (exists (select 1 from public.characters c where c.id = arrow_stacks.character_id and c.account_id = auth.uid()));

create policy "Characters can insert their own arrow stacks"
  on public.arrow_stacks for insert
  with check (exists (select 1 from public.characters c where c.id = arrow_stacks.character_id and c.account_id = auth.uid()));

create policy "Characters can update their own arrow stacks"
  on public.arrow_stacks for update
  using (exists (select 1 from public.characters c where c.id = arrow_stacks.character_id and c.account_id = auth.uid()))
  with check (exists (select 1 from public.characters c where c.id = arrow_stacks.character_id and c.account_id = auth.uid()));

create policy "Characters can delete their own arrow stacks"
  on public.arrow_stacks for delete
  using (exists (select 1 from public.characters c where c.id = arrow_stacks.character_id and c.account_id = auth.uid()));

grant select, insert, update, delete on public.arrow_stacks to authenticated;

-- Preserve any existing test data from the old flat columns as a single stack per
-- type (may exceed the new per-type cap if it already had more than that — the cap
-- only governs new purchases going forward, not a hard invariant on every row).
insert into public.arrow_stacks (character_id, arrow_type, count)
select id, 'iron', (arrows->>'iron')::integer from public.characters where coalesce((arrows->>'iron')::integer, 0) > 0
union all
select id, 'lucky', (arrows->>'lucky')::integer from public.characters where coalesce((arrows->>'lucky')::integer, 0) > 0
union all
select id, 'speed', (arrows->>'speed')::integer from public.characters where coalesce((arrows->>'speed')::integer, 0) > 0;

alter table public.characters add column if not exists equipped_arrow_stack_id uuid references public.arrow_stacks (id) on delete set null;

update public.characters c
set equipped_arrow_stack_id = s.id
from public.arrow_stacks s
where s.character_id = c.id
  and s.arrow_type = c.equipped_arrow_type;

alter table public.characters drop column if exists arrows;
alter table public.characters drop column if exists equipped_arrow_type;

commit;
