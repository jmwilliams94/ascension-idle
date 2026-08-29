// Per-key call serialization (2026-08-29, bug fix reported by the user:
// gold/EXP/kill-count credited more than once within a single visible
// respawn gap). Shared by resolveCombat.ts/resolveRowCombat.ts — both fire
// resolve calls from several independent, uncoordinated triggers (a ~4s
// periodic poll, plus immediate calls on kill/stop/zone-switch/Multi-Shot),
// and nothing stopped two of them from being genuinely in flight at once
// (e.g. a kill happens moments before the next periodic tick was already
// due). The relevant resolve-combat/resolve-row-combat Edge Functions
// correctly prevent two calls from claiming the *same* elapsed-time window
// (resolve_combat_gather_state's combat_last_resolved_at CAS), but the
// actual kill-count/reward increment is applied as a relative delta
// (`kills = kills + p_kills_delta`) off a snapshot read at the *start* of
// each call — if a second call's snapshot read happens before the first
// call's own increment has committed, both compute their own delta off the
// same stale baseline and both get applied, double-crediting rewards for
// what was really a single elapsed stretch.
//
// Since every resolve call for a given character originates from the same
// tab/JS runtime, chaining calls per key closes this off entirely: an
// overlapping call simply waits for the prior one to fully settle (success
// or failure) before it starts, so no two calls for the same key are ever
// in flight together. Nothing is dropped (unlike a "skip if busy" guard) —
// every caller still gets a real result, including ones that await it for
// direct feedback (e.g. a Multi-Shot button click).
const queues = new Map<string, Promise<void>>()

export function serializeByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(task, task)
  // The queue slot itself must never reject (or every later call chained
  // after it would spuriously fail too) — `run`, returned to the caller
  // below, still carries the real success/failure.
  queues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}
