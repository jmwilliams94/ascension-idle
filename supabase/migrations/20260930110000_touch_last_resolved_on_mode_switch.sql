-- Hunting/Mining mode-switch catch-up bug (reported by the user, follow-up
-- to the v1.106.3 client fix): manually starting a mode after time spent in
-- the *other* one replayed that entire gap as a catch-up in the mode just
-- entered. combat_last_resolved_at/mining_last_resolved_at only ever
-- advances when its own mode actually resolves — it sits frozen the whole
-- time its mode is inactive, so the first resolve after a switch always
-- computed elapsed = now - last_resolved_at with no way to know that gap was
-- spent doing something else, not genuinely away. The v1.106.3 fix
-- (CombatEngine.tsx/MiningEngine.tsx's stop-triggered final resolve) only
-- closes out the mode being *left*; the mode being *entered* still carried
-- forward whatever timestamp it was last resolved at, however stale, and
-- MINING_AFK_CAP_MS/combat's own AFK cap let that replay as much as 2+
-- hours of "catch-up" the instant the other mode started.
--
-- These two RPCs let a manual mode switch reset the *entering* mode's
-- pointer to now with zero reward grant, right as it starts — deliberately
-- bypassing the resolve architecture entirely (no reward math, no CAS claim)
-- since a live, conscious "start" action is never a legitimate catch-up
-- moment. Only GameShell's login-time offline-progress check is — and it
-- calls useCombatStore/useMiningStore's start() directly on the store, not
-- through CombatPage.tsx's handleFight / MiningModePanel.tsx's handleMine
-- (the only two callers of these RPCs), so it's untouched by this change.
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

  update public.characters set combat_last_resolved_at = now() where id = p_character_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.touch_combat_last_resolved_at(uuid) from public;
grant execute on function public.touch_combat_last_resolved_at(uuid) to authenticated;

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

  update public.characters set mining_last_resolved_at = now() where id = p_character_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.touch_mining_last_resolved_at(uuid) from public;
grant execute on function public.touch_mining_last_resolved_at(uuid) to authenticated;

commit;
