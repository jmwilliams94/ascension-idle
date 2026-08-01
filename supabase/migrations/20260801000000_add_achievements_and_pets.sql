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
-- Repair block: this file was edited in place (tier-cost redesign, 2026-08-01)
-- after an earlier version had already been run manually via the SQL editor
-- -- the live DB ended up with the OLD shape (tier2_unlocked boolean,
-- unlock_achievement_tier2) while this file's CREATE TABLE IF NOT EXISTS
-- below silently no-ops against an already-existing table, and CREATE OR
-- REPLACE FUNCTION creates unlock_next_achievement_tier as a *new* function
-- alongside the old one rather than replacing it -- which is exactly what
-- produced the "function not found in schema cache" PGRST202 error the user
-- hit (the client calls the new name, but the table was still missing the
-- new column). This block makes the file safe to re-run regardless of
-- whether the DB is fresh, partially migrated, or already fully migrated.
-- No real data is at stake -- this feature was never actually reachable
-- before now, so there's nothing meaningful in tier2_unlocked to preserve.
-- ============================================================================
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'character_monster_kills' and column_name = 'tier2_unlocked'
  ) then
    alter table public.character_monster_kills drop column tier2_unlocked;
  end if;
end $$;

drop function if exists public.unlock_achievement_tier2(uuid, text);

-- ============================================================================
-- character_monster_kills: per-character kill-count ladder, one row per
-- (character, monster) once that character has ever killed it. Also carries
-- that character's own unlocked_tier_index -- confirmed with the user
-- (2026-08-01, supersedes the original single "pay 50 DragonBalls once" tier2
-- gate): EVERY tier now costs something to unlock, escalating from cheap
-- Meteors up to a DragonBall at the top, paid one tier at a time in order.
-- 0 means no tier paid for yet; 6 means all six tiers unlocked. Scoped
-- per-monster-per-character ("dedicated farming of one monster"), not a
-- single global unlock.
-- ============================================================================
create table if not exists public.character_monster_kills (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  monster_id text not null references public.enemy_types (id),
  kills integer not null default 0,
  unlocked_tier_index integer not null default 0,
  created_at timestamptz not null default now(),
  constraint character_monster_kills_kills_check check (kills >= 0),
  constraint character_monster_kills_unlocked_tier_index_check check (unlocked_tier_index between 0 and 6),
  constraint character_monster_kills_unique unique (character_id, monster_id)
);

-- Belt-and-braces for a table that already existed pre-redesign (see the
-- repair block above) -- a no-op on a freshly created table, since it
-- already has this column from the CREATE TABLE above.
alter table public.character_monster_kills add column if not exists unlocked_tier_index integer not null default 0;

do $$ begin
  alter table public.character_monster_kills
    add constraint character_monster_kills_unlocked_tier_index_check check (unlocked_tier_index between 0 and 6);
exception when duplicate_object then null;
end $$;

alter table public.character_monster_kills enable row level security;

do $$ begin
  create policy "Characters can view their own kill counts"
    on public.character_monster_kills for select
    using (exists (select 1 from public.characters c where c.id = character_monster_kills.character_id and c.account_id = auth.uid()));
exception when duplicate_object then null;
end $$;

-- No insert/update/delete grant at all -- every mutation happens through
-- resolve-combat's service-role client (bypasses RLS as owner) or the
-- unlock_next_achievement_tier RPC below.
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
-- unlock_next_achievement_tier: unlocks the NEXT tier in sequence (1..6, in
-- ACHIEVEMENT_TIERS order: 100/250/500/1000/5000/10000) for one character's
-- kill count on one monster -- the caller never picks which tier, only
-- "buy the next one," so tiers can't be unlocked out of order. Cost
-- escalates per tier (confirmed with the user, 2026-08-01, replacing the
-- original flat 50-DragonBall gate -- must match
-- src/game/achievements/achievementData.ts's ACHIEVEMENT_TIER_COSTS):
--   tier 1 (100 kills):    1 Meteor
--   tier 2 (250 kills):    3 Meteors
--   tier 3 (500 kills):    5 Meteors
--   tier 4 (1000 kills):  10 Meteors
--   tier 5 (5000 kills):  20 Meteors
--   tier 6 (10000 kills):  1 DragonBall
-- Creates the character_monster_kills row at 0 kills if the character's
-- never fought this monster before paying for it. Unlocking a tier ahead of
-- actually reaching its kill count is allowed (the reward simply won't be
-- active until the kill count catches up) -- see resolve-combat's own
-- currentAchievementGoldMultiplier.
-- ============================================================================
-- Parameters are prefixed p_ (2026-08-02, supersedes the previous
-- funcname.paramname qualification attempt, which turned out not to be
-- enough) -- both character_monster_kills columns and these bare parameter
-- names collided ("character_id"/"monster_id"), and quoting one occurrence
-- in the VALUES list still left the error recurring elsewhere. Renaming the
-- parameters outright removes the whole class of ambiguity instead of
-- patching individual call sites — the standard PL/pgSQL fix for this,
-- rather than relying on qualification syntax. The RPC is called with named
-- arguments from the client (see useAchievementsStore.ts's unlockNextTier),
-- so that call was updated to match: p_character_id/p_monster_id.
create or replace function public.unlock_next_achievement_tier(p_character_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_meteors integer;
  v_dragonballs integer;
  v_current_index integer;
  v_next_index integer;
  v_currency text;
  v_cost integer;
  v_new_meteors integer;
  v_new_dragonballs integer;
begin
  select account_id, meteor_count, dragonball_count into v_account_id, v_meteors, v_dragonballs
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select unlocked_tier_index into v_current_index
  from public.character_monster_kills
  where character_id = p_character_id
    and monster_id = p_monster_id;

  v_current_index := coalesce(v_current_index, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  case v_next_index
    when 1 then v_currency := 'meteor'; v_cost := 1;
    when 2 then v_currency := 'meteor'; v_cost := 3;
    when 3 then v_currency := 'meteor'; v_cost := 5;
    when 4 then v_currency := 'meteor'; v_cost := 10;
    when 5 then v_currency := 'meteor'; v_cost := 20;
    when 6 then v_currency := 'dragonball'; v_cost := 1;
  end case;

  if v_currency = 'meteor' then
    if v_meteors < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_meteors', 'cost', v_cost, 'currency', v_currency, 'meteors', v_meteors);
    end if;
    update public.characters set meteor_count = meteor_count - v_cost where id = p_character_id
    returning meteor_count into v_new_meteors;
    v_new_dragonballs := v_dragonballs;
  else
    if v_dragonballs < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_dragonballs', 'cost', v_cost, 'currency', v_currency, 'dragonballs', v_dragonballs);
    end if;
    update public.characters set dragonball_count = dragonball_count - v_cost where id = p_character_id
    returning dragonball_count into v_new_dragonballs;
    v_new_meteors := v_meteors;
  end if;

  insert into public.character_monster_kills (character_id, monster_id, kills, unlocked_tier_index)
  values (p_character_id, p_monster_id, 0, v_next_index)
  on conflict (character_id, monster_id)
  do update set unlocked_tier_index = v_next_index;

  return jsonb_build_object(
    'ok', true,
    'unlocked_tier_index', v_next_index,
    'currency', v_currency,
    'cost', v_cost,
    'meteors_remaining', v_new_meteors,
    'dragonballs_remaining', v_new_dragonballs
  );
end;
$$;

revoke all on function public.unlock_next_achievement_tier(uuid, text) from public;
grant execute on function public.unlock_next_achievement_tier(uuid, text) to authenticated;

commit;
