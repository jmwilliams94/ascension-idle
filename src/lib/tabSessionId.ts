const TAB_SESSION_ID_KEY = 'ascension-tab-session-id'

// sessionStorage (not localStorage) is scoped to this one tab and survives a
// reload/navigation within it, but a genuinely different tab or device always
// gets a fresh sessionStorage of its own. Shared by GlobalActivityConnection.tsx's
// session-conflict detection and resolveCombat.ts's server-side session
// fencing (see the 20261119000000_resolve_combat_session_fencing.sql
// migration) -- both need the exact same identity for "this tab" that a
// refresh recognizes as itself but a genuinely new tab/device never does.
export function getTabSessionId(): string {
  const existing = sessionStorage.getItem(TAB_SESSION_ID_KEY)
  if (existing) {
    return existing
  }
  const id = crypto.randomUUID()
  sessionStorage.setItem(TAB_SESSION_ID_KEY, id)
  return id
}
