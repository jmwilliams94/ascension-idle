-- Fixes a "lost update" race on the Achievements kill counters, the same
-- class of bug resolve_combat_apply_rewards was already built to close for
-- gold/exp/comet/fallen_star (see that function's own migration/comment).
-- resolve-combat/index.ts was writing character_monster_kills/
-- account_monster_kills via a plain read-old-value-then-write-absolute-total
-- pattern (`characterKillsBefore + killsThisWindow`, computed from a row
-- read at the *start* of the function). Two resolve-combat invocations for
-- the same character landing close together (the periodic ~4s interval call
-- and an immediate call on stop/switch/visibilitychange/beforeunload can
-- easily overlap) would both read the same starting kill count and each
-- write back an absolute total — whichever finishes last silently discards
-- the other's kills. This function does the increment as a single
-- `kills = kills + delta` upsert instead, which Postgres guarantees is safe
-- against any concurrent writer to the same row, no matter how two calls
-- interleave — mirrors resolve_combat_apply_rewards' own fix exactly.
create or replace function public.resolve_combat_apply_kill_counts(
  p_character_id uuid,
  p_account_id uuid,
  p_monster_id text,
  p_kills_delta integer
)
returns table (character_kills integer, account_kills integer)
language plpgsql
as $$
declare
  v_character_kills integer;
  v_account_kills integer;
begin
  insert into public.character_monster_kills (character_id, monster_id, kills)
  values (p_character_id, p_monster_id, p_kills_delta)
  on conflict (character_id, monster_id)
  do update set kills = public.character_monster_kills.kills + excluded.kills
  returning kills into v_character_kills;

  insert into public.account_monster_kills (account_id, monster_id, kills)
  values (p_account_id, p_monster_id, p_kills_delta)
  on conflict (account_id, monster_id)
  do update set kills = public.account_monster_kills.kills + excluded.kills
  returning kills into v_account_kills;

  return query select v_character_kills, v_account_kills;
end;
$$;

revoke all on function public.resolve_combat_apply_kill_counts(uuid, uuid, text, integer) from public;
grant execute on function public.resolve_combat_apply_kill_counts(uuid, uuid, text, integer) to service_role;
