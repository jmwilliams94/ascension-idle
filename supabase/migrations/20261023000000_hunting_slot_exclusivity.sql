-- Hunting is account-wide exclusive: only one character per account may hold
-- a live Hunting session (selected_monster_id + last_active_idle_mode =
-- 'hunting') at a time. Without this, offline/AFK catch-up is resolved
-- independently per character (resolve-combat's own combat_last_resolved_at,
-- see CLAUDE.persistence.md) -- an account with several characters all
-- parked on Hunting could claim the same real-world elapsed away-time
-- multiple times over, once per character, by visiting each on login
-- (reported by the user). Mining stays unrestricted -- several characters
-- may mine in parallel.
--
-- players.hunting_character_id is the single source of truth for who
-- currently holds the slot. Enforcement doesn't need resolve-combat/Deno
-- changes at all: claim_hunting_slot clears the DISPLACED character's own
-- selected_monster_id (and flips it to Mining mode), so resolve-combat's
-- existing "no monster selected -> no-op" early return (already there,
-- unrelated to this fix) naturally stops that character from accruing
-- anything further, live or offline, until it re-claims the slot itself.
begin;

alter table public.players
  add column if not exists hunting_character_id uuid references public.characters (id) on delete set null;

-- Seed: several characters may already be independently parked on Hunting
-- (this bug has been live). Per account, whichever such character was most
-- recently active claims the slot; every other one is force-switched to
-- Mining and loses its selected monster, closing the exploit window
-- immediately rather than only for future claims.
with ranked as (
  select c.id, c.account_id,
    row_number() over (partition by c.account_id order by c.last_active_at desc) as rn
  from public.characters c
  where c.last_active_idle_mode = 'hunting'
)
update public.players p
set hunting_character_id = r.id
from ranked r
where r.account_id = p.id and r.rn = 1;

with ranked as (
  select c.id, c.account_id,
    row_number() over (partition by c.account_id order by c.last_active_at desc) as rn
  from public.characters c
  where c.last_active_idle_mode = 'hunting'
)
update public.characters c
set selected_monster_id = null, last_active_idle_mode = 'mining'
from ranked r
where c.id = r.id and r.rn <> 1;

-- Auto-takeover, no confirmation (confirmed by the user): claiming always
-- succeeds for the caller's own character and instantly displaces whoever
-- held the slot before, same "last action wins" precedent
-- last_active_idle_mode itself already follows per-character. Returns the
-- displaced character's name (null if the slot was unclaimed or already
-- this character's) so the client can show a "took over Hunting from X" toast.
create or replace function public.claim_hunting_slot(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_previous_hunter_id uuid;
  v_previous_hunter_name text;
begin
  select account_id into v_account_id from public.characters where id = p_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select hunting_character_id into v_previous_hunter_id from public.players where id = v_account_id for update;

  if v_previous_hunter_id is not null and v_previous_hunter_id <> p_character_id then
    select name into v_previous_hunter_name from public.characters where id = v_previous_hunter_id;

    update public.characters
    set selected_monster_id = null, last_active_idle_mode = 'mining'
    where id = v_previous_hunter_id;
  end if;

  update public.players set hunting_character_id = p_character_id where id = v_account_id;

  return jsonb_build_object('ok', true, 'previous_hunter_id', v_previous_hunter_id, 'previous_hunter_name', v_previous_hunter_name);
end;
$$;

grant execute on function public.claim_hunting_slot(uuid) to authenticated;

-- Called when a character that currently holds the slot voluntarily switches
-- itself to Mining (MiningModePanel.tsx's handleMine), so the slot reads as
-- free immediately rather than staying pointed at a character that's no
-- longer actually hunting until someone else claims it. A no-op (0 rows
-- affected) if this character doesn't hold the slot.
create or replace function public.release_hunting_slot(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.players set hunting_character_id = null
  where id = v_account_id and hunting_character_id = p_character_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.release_hunting_slot(uuid) to authenticated;

commit;
