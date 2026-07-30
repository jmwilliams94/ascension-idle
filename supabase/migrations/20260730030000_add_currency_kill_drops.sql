-- Meteor (1/500) and Dragonball (1/20,000) kill-drop rolls are confirmed rates
-- (2026-07-30), not placeholders like most of this economy — see
-- combatResolver.ts's rollBonusCurrencyDrops. Previously these two currencies
-- had no earn mechanic at all (manual Supabase table-editor edits only), which
-- is why they were deliberately left out of the generic autosave (see
-- useCurrencyStore.ts) — only the quality_upgrade/level_upgrade RPCs wrote
-- them, so the client only ever had to reflect a response, never race a write.
--
-- Now that kills grant them too, a plain client-side increment would reopen
-- that exact race: a kill grant reading a stale local balance and writing
-- "old + 1" could stomp on a nearly-simultaneous Forge upgrade's server-side
-- deduction. grant_currency_reward avoids this the same way transfer_currency
-- does — a single atomic `column = column + amount` UPDATE, not a
-- read-then-write — so it's safe to call from combat without an explicit lock
-- racing the upgrade RPCs' own row locks.
create or replace function public.grant_currency_reward(character_id uuid, meteors_gained integer, dragonballs_gained integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_meteors integer;
  v_dragonballs integer;
begin
  if meteors_gained < 0 or dragonballs_gained < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_account_id from public.characters where id = character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.characters
  set meteors = meteors + meteors_gained, dragonballs = dragonballs + dragonballs_gained
  where id = character_id
  returning meteors, dragonballs into v_meteors, v_dragonballs;

  return jsonb_build_object('ok', true, 'meteors', v_meteors, 'dragonballs', v_dragonballs);
end;
$$;

revoke all on function public.grant_currency_reward(uuid, integer, integer) from public;
grant execute on function public.grant_currency_reward(uuid, integer, integer) to authenticated;
