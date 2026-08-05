-- Fixes a real lost-update race, reported by the user: "I tried to Bundle
-- some comets in the shop interface. They bundled but then the action
-- reversed."
--
-- Root cause: resolve-combat/index.ts reads the `characters` row once at the
-- start of a call, runs its whole attack-simulation loop, then writes
-- gold/comet_count/fallen_star_count back as plain JS-computed absolute
-- values (`character.comet_count + cometsToGrant`, etc.) via a single
-- `.update({...})` call. If anything else (bundle_currency_scroll,
-- sell_item, a Forge upgrade's comet/fallen-star cost, ...) modifies the
-- same row in between that initial read and this final write, the earlier
-- change is silently clobbered back to whatever resolve-combat's own stale
-- snapshot said — a classic lost-update problem, not a client-display
-- glitch. This got dramatically more likely to be hit once RESOLVE_INTERVAL_MS
-- was shortened from 15s to 4s (see CLAUDE.md's predictive-leveling note),
-- since resolve-combat now fires roughly 4x more often while fighting.
--
-- This project already has an established pattern for exactly this shape of
-- problem — a single atomic `column = column + delta` UPDATE inside a
-- SECURITY DEFINER/service-role-only Postgres function (see quality_upgrade,
-- level_upgrade, transfer_currency, and the now-dropped grant_currency_reward
-- this one effectively revives) — the Supabase JS/postgrest client used by
-- the Edge Function has no way to express `column = column + delta` directly
-- through `.update()`, only literal values, so the increment has to happen
-- inside the database via a real SQL statement.
--
-- exp/level are NOT delta-based here (still plain absolute overwrites) —
-- resolve-combat is the sole writer of those two fields from the server
-- side (nothing else grants EXP or levels a character up), so there's no
-- concurrent-server-write race for them the way there is for gold/comet/
-- fallen-star counts. The client's own debounced autosave can still race
-- exp/level/gold against this, but that's a distinct, pre-existing,
-- already-documented trust-model trade-off (see CLAUDE.md's Persistence
-- section) — not something this fix attempts to redesign.
create or replace function public.resolve_combat_apply_rewards(
  p_character_id uuid,
  p_gold_delta integer,
  p_exp integer,
  p_level integer,
  p_comet_delta integer,
  p_fallen_star_delta integer,
  p_resolved_at timestamptz
)
returns table (gold integer, comet_count integer, fallen_star_count integer)
language plpgsql
as $$
begin
  return query
  update public.characters
  set
    gold = characters.gold + p_gold_delta,
    exp = p_exp,
    level = p_level,
    comet_count = characters.comet_count + p_comet_delta,
    fallen_star_count = characters.fallen_star_count + p_fallen_star_delta,
    combat_last_resolved_at = p_resolved_at
  where characters.id = p_character_id
  returning characters.gold, characters.comet_count, characters.fallen_star_count;
end;
$$;

-- service_role only — this trusts every argument completely (no ownership
-- check, no cost validation), which is only safe because the sole caller is
-- resolve-combat's own service-role client, never a player-facing RPC call.
revoke all on function public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, timestamptz) from public;
grant execute on function public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, timestamptz) to service_role;
