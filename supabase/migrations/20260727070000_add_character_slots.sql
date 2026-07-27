-- Restructures greybox-idle from one-character-per-account to up to 5 character
-- slots per account. This is a large, one-time, NON-reentrant migration (it drops
-- and renames columns and backfills data) — apply exactly once. Wrapped in a single
-- transaction so a failure partway through doesn't leave things half-migrated.
begin;

-- === 1. New characters table ===================================================
create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete cascade,
  slot_index integer not null,
  class text,
  level integer not null default 1,
  exp integer not null default 0,
  gold integer not null default 0,
  meteors integer not null default 0,
  dragonballs integer not null default 0,
  equipped_item_id uuid references public.item_instances (id) on delete set null,
  current_zone text not null default 'Twincross Outskirts',
  created_at timestamptz not null default now(),
  constraint characters_slot_index_check check (slot_index between 1 and 5),
  constraint characters_account_slot_unique unique (account_id, slot_index),
  constraint characters_level_check check (level >= 1),
  constraint characters_exp_check check (exp >= 0),
  constraint characters_gold_check check (gold >= 0),
  constraint characters_meteors_check check (meteors >= 0),
  constraint characters_dragonballs_check check (dragonballs >= 0)
);

alter table public.characters enable row level security;

create policy "Accounts can view their own characters"
  on public.characters for select
  using (account_id = auth.uid());

create policy "Accounts can insert their own characters"
  on public.characters for insert
  with check (account_id = auth.uid());

create policy "Accounts can update their own characters"
  on public.characters for update
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- Learned this the hard way on item_templates/item_instances (see CLAUDE.md's
-- Persistence migration gotcha) — RLS policies alone are not enough, tables created
-- via raw SQL need explicit table-level grants too.
grant select, insert, update on public.characters to authenticated;

-- === 2. Data migration: preserve existing progress as each account's first character
insert into public.characters (account_id, slot_index, class, level, exp, gold, meteors, dragonballs, equipped_item_id, current_zone)
select id, 1, class, level, exp, gold, meteors, dragonballs, equipped_item_id, current_zone
from public.players
where not exists (
  select 1 from public.characters c where c.account_id = players.id and c.slot_index = 1
);

-- === 3. item_instances now belongs to a character, not directly to an account =====
-- Drop the old owner_id-based policies first — Postgres won't let you drop a column
-- that a policy's USING/WITH CHECK expression depends on.
drop policy if exists "Players can view their own item instances" on public.item_instances;
drop policy if exists "Players can insert their own item instances" on public.item_instances;

alter table public.item_instances add column if not exists owner_character_id uuid;

update public.item_instances ii
set owner_character_id = c.id
from public.characters c
where c.account_id = ii.owner_id
  and c.slot_index = 1
  and ii.owner_character_id is null;

alter table public.item_instances alter column owner_character_id set not null;
alter table public.item_instances drop column owner_id;
alter table public.item_instances rename column owner_character_id to owner_id;
alter table public.item_instances
  add constraint item_instances_owner_id_fkey foreign key (owner_id) references public.characters (id) on delete cascade;

create policy "Characters can view their own item instances"
  on public.item_instances for select
  using (exists (select 1 from public.characters c where c.id = item_instances.owner_id and c.account_id = auth.uid()));

create policy "Characters can insert their own item instances"
  on public.item_instances for insert
  with check (exists (select 1 from public.characters c where c.id = item_instances.owner_id and c.account_id = auth.uid()));

-- === 4. quality_upgrade/level_upgrade: ownership + currency now go through the ====
-- owning character (currency is per-character now, not per-account).
create or replace function public.quality_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_tier text;
  v_next_tier text;
  v_cost integer;
  v_success_chance numeric := 0.7;
  v_dragonballs integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier into v_character_id, v_current_tier
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, dragonballs into v_account_id, v_dragonballs
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_next_tier := case v_current_tier
    when 'normal' then 'refined'
    when 'refined' then 'unique'
    when 'unique' then 'elite'
    when 'elite' then 'super'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  v_cost := case v_current_tier
    when 'normal' then 1
    when 'refined' then 2
    when 'unique' then 3
    when 'elite' then 4
    else 1
  end;

  if v_dragonballs < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_dragonballs',
      'cost', v_cost,
      'dragonballs', v_dragonballs
    );
  end if;

  update public.characters set dragonballs = dragonballs - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'dragonballs_spent', v_cost,
    'dragonballs_remaining', v_dragonballs - v_cost
  );
end;
$$;

create or replace function public.level_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_level integer;
  v_level_cap integer := 130;
  v_cost integer;
  v_success_chance numeric := 0.8;
  v_meteors integer;
  v_upgraded boolean;
begin
  select owner_id, level into v_character_id, v_current_level
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, meteors into v_account_id, v_meteors
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_current_level >= v_level_cap then
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

  v_cost := 1 + (v_current_level / 5);

  if v_meteors < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_meteors',
      'cost', v_cost,
      'meteors', v_meteors
    );
  end if;

  update public.characters set meteors = meteors - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set level = level + 1 where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_current_level + 1 else v_current_level end,
    'meteors_spent', v_cost,
    'meteors_remaining', v_meteors - v_cost
  );
end;
$$;

grant execute on function public.quality_upgrade(uuid) to authenticated;
grant execute on function public.level_upgrade(uuid) to authenticated;

-- === 5. players keeps only account-level fields ===================================
-- bank_gold: shared account-wide bank, schema only this step (no deposit/withdraw UI
-- yet, nothing else touches it). unlocked_classes: account-wide class-unlock
-- milestones (e.g. a Hunter reaching max level), not per-character.
alter table public.players
  add column if not exists bank_gold integer not null default 0,
  add column if not exists unlocked_classes text[] not null default array['hunter'];

alter table public.players add constraint players_bank_gold_check check (bank_gold >= 0);

alter table public.players
  drop column if exists class,
  drop column if exists level,
  drop column if exists gold,
  drop column if exists exp,
  drop column if exists meteors,
  drop column if exists dragonballs,
  drop column if exists equipped_item_id,
  drop column if exists current_zone;

commit;
