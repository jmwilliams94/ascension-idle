import { useStaleClientStore } from './useStaleClientStore'

// PostgREST's own error codes for "the RPC this client just called doesn't
// exist with these arguments" — see https://postgrest.org/en/stable/references/errors.html.
// PGRST202: no function matches the given name+argument-shape at all.
// PGRST203: more than one overload matches (ambiguous) — can't happen from
// this project's own `drop function` convention (CLAUDE.md's own gotcha:
// every signature change explicitly drops the old overload first, so there
// should never be two live at once), but a stale client mid-deploy racing a
// migration that hasn't finished yet is exactly the shape of window where it
// could transiently appear — treated the same as PGRST202 either way, since
// both mean "this exact call shape isn't valid against the current schema."
//
// This is deliberately narrow: it only ever fires for a `/rest/v1/rpc/`
// call whose response body carries one of these two specific codes — a
// plain 404 from somewhere else, a network failure, a genuine validation
// error the RPC itself returned (those come back as ok:false in the JSON
// body, not an HTTP-level PostgREST error) all pass through untouched. See
// useStaleClientStore.ts for why detecting this alone still isn't enough to
// tell the player anything — that only happens once a real newer build is
// also confirmed available.
const STALE_SCHEMA_ERROR_CODES = new Set(['PGRST202', 'PGRST203'])

export function createStaleClientAwareFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init)

    if (!response.ok) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/rest/v1/rpc/')) {
        // Clone before reading — the real caller (postgrest-js) still needs
        // to consume the original response body itself.
        void response
          .clone()
          .json()
          .then((body: unknown) => {
            const code = (body as { code?: unknown } | null)?.code
            if (typeof code === 'string' && STALE_SCHEMA_ERROR_CODES.has(code)) {
              useStaleClientStore.getState().reportSchemaMismatch()
            }
          })
          .catch(() => {
            // Not JSON, or some other shape — not the error this is looking
            // for, ignore.
          })
      }
    }

    return response
  }
}
