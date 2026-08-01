-- Achievements & Pets, Stage 1 (confirmed shape documented in CLAUDE.md from a
-- mobile session; this migration implements the tracking/reward *mechanism*
-- only, using one uniform placeholder reward -- real per-monster tier
-- content, the account-wide ladder's own reward category, and the Pet buff's
-- actual effect are all explicitly undecided per the user and are NOT
-- invented here. See CLAUDE.md's Achievements & Pets section.
--
-- Three new tables, following the row-per-key pattern warehouse_items already
-- established (real FK, real CHECK constraint) rather than a jsonb map
-- (composition_stones's own comments note jsonb can't have a CHECK
-- constraint -- not a good fit for ~40 monster ids anyway).
begin;

-- ============================================================================
-- character_monster_kills: per-character kill-count ladder, one row per
-- (character, monster) once that character has ever killed it. Also carries
-- that character's own paid tier2_unlocked flag -- the DragonBall-paid
-- upgrade is scoped per-monster-per-character ("dedicated farming of one
-- monster"), not a single global unlock.
-- ============================================================================
create table if not exists public.character_monster_kills (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  monster_id text not null references public.enemy_types (id),
  kills integer not null default 0,
  tier2_unlocked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint character_monster_kills_kills_check check (kills >= 0),
  constraint character_monster_kills_unique unique (character_id, monster_id)
);

alter table public.character_monster_kills enable row level security;

do $$ begin
  create policy "Characters can view their own kill counts"
    on public.character_monster_kills for select
    using (exists (select 1 from public.characters c where c.id = character_monster_kills.character_id and c.account_id = auth.uid()));
exception when duplicate_object then null;
end $$;

-- No insert/update/delete grant at all -- every mutation happens through
-- resolve-combat's service-role client (bypasses RLS as owner) or the
-- unlock_achievement_tier2 RPC below.
grant select on public.character_monster_kills to authenticated;

-- ============================================================================
-- account_monster_kills: account-wide kill-count ladder -- a denormalized
-- running total, incremented by the same delta as the per-character row
-- every time a kill happens (same "account bank vs character wallet"
-- dual-counter precedent this game already uses for gold/meteors/
-- dragonballs), not summed across characters on read.
-- ============================================================================
create table if not exists public.account_monster_kills (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.players (id) on delete cascade,
  monster_id text not null references public.enemy_types (id),
  kills integer not null default 0,
  created_at timestamptz not null default now(),
  constraint account_monster_kills_kills_check check (kills >= 0),
  constraint account_monster_kills_unique unique (account_id, monster_id)
);

alter table public.account_monster_kills enable row level security;

do $$ begin
  create policy "Accounts can view their own account-wide kill counts"
    on public.account_monster_kills for select
    using (account_id = auth.uid());
exception when duplicate_object then null;
end $$;

grant select on public.account_monster_kills to authenticated;

-- ============================================================================
-- account_pets: existence of a row = that monster's pet is obtained,
-- account-wide, forever -- once any character on the account rolls it, no
-- character (including that one) can ever roll it again.
-- ============================================================================
create table if not exists public.account_pets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.players (id) on delete cascade,
  monster_id text not null references public.enemy_types (id),
  unlocked_at timestamptz not null default now(),
  constraint account_pets_unique unique (account_id, monster_id)
);

alter table public.account_pets enable row level security;

do $$ begin
  create policy "Accounts can view their own pets"
    on public.account_pets for select
    using (account_id = auth.uid());
exception when duplicate_object then null;
end $$;

grant select on public.account_pets to authenticated;

-- ============================================================================
-- unlock_achievement_tier2: spends a flat PLACEHOLDER DragonBall cost (see
-- src/game/achievements/achievementData.ts's ACHIEVEMENT_TIER2_COST -- keep
-- in sync) to unlock the 1000/5000/10000 tier set for one character's kill
-- count on one monster. Creates the character_monster_kills row at 0 kills
-- if the character's never fought this monster before paying for it.
-- ============================================================================
create or replace function public.unlock_achievement_tier2(character_id uuid, monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_dragonballs integer;
  v_cost integer := 50; -- PLACEHOLDER, unresolved per CLAUDE.md -- must match achievementData.ts
  v_already_unlocked boolean;
  v_new_dragonballs integer;
begin
  select account_id, dragonball_count into v_account_id, v_dragonballs
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select tier2_unlocked into v_already_unlocked
  from public.character_monster_kills
  where character_monster_kills.character_id = unlock_achievement_tier2.character_id
    and character_monster_kills.monster_id = unlock_achievement_tier2.monster_id;

  if v_already_unlocked then
    return jsonb_build_object('ok', false, 'error', 'already_unlocked');
  end if;

  if v_dragonballs < v_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_dragonballs', 'cost', v_cost, 'dragonballs', v_dragonballs);
  end if;

  update public.characters set dragonball_count = dragonball_count - v_cost where id = character_id
  returning dragonball_count into v_new_dragonballs;

  insert into public.character_monster_kills (character_id, monster_id, kills, tier2_unlocked)
  values (character_id, monster_id, 0, true)
  on conflict (character_id, monster_id)
  do update set tier2_unlocked = true;

  return jsonb_build_object('ok', true, 'dragonballs_spent', v_cost, 'dragonballs_remaining', v_new_dragonballs);
end;
$$;

revoke all on function public.unlock_achievement_tier2(uuid, text) from public;
grant execute on function public.unlock_achievement_tier2(uuid, text) to authenticated;

commit;
