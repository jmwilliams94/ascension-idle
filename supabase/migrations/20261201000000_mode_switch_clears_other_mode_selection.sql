-- Hunting and Mining could be simultaneously live for one character across
-- two open sessions (reported by a real user; second report of the same
-- underlying gap after the resolve-mining overlap-cap fix, 20261130-adjacent
-- session). Switching modes (CombatPage.tsx's handleFight / MiningModePanel
-- .tsx's handleMine) only ever reset last_active_idle_mode and the
-- *entering* mode's own last_resolved_at clock (20260930110000) -- neither
-- ever cleared the *other* mode's own selected_monster_id/selected_mine_id
-- pointer on this same character. Those pointers are each resolver's real
-- "am I active" guard (resolve-combat/resolve-mining both no-op when their
-- own selection column is null) -- see claim_hunting_slot's own comment for
-- the identical mechanism already used to stop a *displaced* character's
-- own future accrual. Leaving the abandoned mode's pointer set meant any
-- *other* already-open session for the same character (a second tab,
-- another device) kept resolving that abandoned mode live indefinitely --
-- both modes' rewards accruing concurrently for the same wall-clock
-- stretch. Confirmed live: 7 characters currently carry both pointers set
-- at once.
--
-- Fix: touch_combat_last_resolved_at (called on entering Hunting) now also
-- clears selected_mine_id; touch_mining_last_resolved_at (called on
-- entering Mining) now also clears selected_monster_id. Same signatures,
-- safe create-or-replace. Client-side, touch_mining_last_resolved_at is now
-- called unconditionally on every handleMine (previously gated behind this
-- tab's own local isFighting flag, which is exactly the blind spot that let
-- a stale selected_monster_id from a *different* session survive).
begin;

create or replace function public.touch_combat_last_resolved_at(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.characters
  set combat_last_resolved_at = now(), selected_mine_id = null
  where id = p_character_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.touch_mining_last_resolved_at(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.characters
  set mining_last_resolved_at = now(), selected_monster_id = null
  where id = p_character_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Data fix: characters currently carrying both pointers at once. Clear
-- whichever one doesn't match last_active_idle_mode (the mode not shown
-- live in that character's own last-used session), touching that mode's
-- own clock to now() too so it can't replay a stale catch-up if the
-- abandoned mode is ever manually re-entered.
update public.characters
set selected_mine_id = null, mining_last_resolved_at = now()
where selected_monster_id is not null
  and selected_mine_id is not null
  and last_active_idle_mode = 'hunting';

update public.characters
set selected_monster_id = null, combat_last_resolved_at = now()
where selected_monster_id is not null
  and selected_mine_id is not null
  and last_active_idle_mode = 'mining';

commit;
