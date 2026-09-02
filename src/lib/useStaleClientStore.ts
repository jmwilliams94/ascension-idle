import { create } from 'zustand'
import { useAppUpdateStore } from './useAppUpdateStore'
import { recordEvent } from './debugTrail'

// Backs StaleClientNotice.tsx (see staleClientFetch.ts for the actual
// detection — this store is just the shared signal between "an RPC just
// failed in a way that looks like a stale client" and "do we actually have
// a confirmed newer build to point them at").
//
// Deliberately two independent signals, not one (2026-09-02, requested by
// the user, worried about false-positive spam on a genuine server-side bug
// unrelated to client staleness): reportSchemaMismatch() only ever records
// *that* an error looking like a schema mismatch happened and nudges an
// update check along — it does NOT by itself claim "you're out of date" to
// the player. StaleClientNotice only ever renders once BOTH this and
// useAppUpdateStore's own needRefresh (a real newer build, independently
// confirmed installed and waiting) are true within the same window — a bug
// that isn't actually a version-skew issue never has a newer build to
// refresh to, so needRefresh stays false and nothing is ever shown for it.
interface StaleClientState {
  lastSchemaErrorAt: number | null
  // Shown at most once per session even if several calls fail in a burst —
  // set the moment StaleClientNotice decides to show it, never reset. A
  // timestamp (not a bare boolean) so the notice's own auto-hide window can
  // be computed from it without a second field.
  noticeShownAt: number | null
  reportSchemaMismatch: () => void
  markNoticeShown: () => void
}

export const useStaleClientStore = create<StaleClientState>((set) => ({
  lastSchemaErrorAt: null,
  noticeShownAt: null,
  reportSchemaMismatch: () => {
    recordEvent('stale-client:schema-mismatch')
    set({ lastSchemaErrorAt: Date.now() })
    // Best-effort nudge — don't wait for the next UPDATE_CHECK_INTERVAL_MS
    // tick (main.tsx) to find out whether a fix already shipped.
    void useAppUpdateStore.getState().registration?.update()
  },
  markNoticeShown: () => set({ noticeShownAt: Date.now() }),
}))
