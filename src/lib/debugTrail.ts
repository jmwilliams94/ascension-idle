// Temporary diagnostic aid (2026-09-02) for the login-screen "refresh" bug --
// every theory tried so far (SW auto-reload, script-load races, autofill
// re-trigger) has been ruled out by the user's live testing, so instead of
// guessing further this records a persistent, timestamped breadcrumb trail
// across reloads (localStorage survives a real navigation, unlike in-memory
// state) covering page lifecycle + Turnstile's own internal events. Reveal
// via LoginForm's hidden tap gesture. Remove once the root cause is found.

const STORAGE_KEY = 'ascension_debug_trail'
const MAX_ENTRIES = 60

interface TrailEntry {
  t: number
  name: string
  detail?: string
}

function readTrail(): TrailEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as TrailEntry[]) : []
  } catch {
    return []
  }
}

export function recordEvent(name: string, detail?: string): void {
  try {
    const trail = readTrail()
    trail.push({ t: Date.now(), name, detail })
    while (trail.length > MAX_ENTRIES) trail.shift()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trail))
  } catch {
    // best-effort only
  }
}

export function getTrail(): TrailEntry[] {
  return readTrail()
}

export function clearTrail(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // best-effort only
  }
}

export function formatTrail(): string {
  return getTrail()
    .map((entry) => {
      const time = new Date(entry.t).toISOString().slice(11, 23)
      return entry.detail ? `${time}  ${entry.name}  (${entry.detail})` : `${time}  ${entry.name}`
    })
    .join('\n')
}

// Fires on every module load (i.e. every real page load, including a full
// document reload) -- performance navigation `type` is the one unambiguous
// signal for "was this actually a browser-level reload/navigate/back-forward,"
// unlike anything inferred from React state.
function recordPageLoad() {
  let navType = 'unknown'
  try {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    navType = entry?.type ?? 'unknown'
  } catch {
    // ignore
  }
  recordEvent('page-load', `navType=${navType} visibility=${document.visibilityState}`)
}

recordPageLoad()

window.addEventListener('pagehide', (event) => {
  recordEvent('pagehide', `persisted=${event.persisted}`)
})
window.addEventListener('beforeunload', () => {
  recordEvent('beforeunload')
})
document.addEventListener('visibilitychange', () => {
  recordEvent('visibilitychange', document.visibilityState)
})
window.addEventListener('pageshow', (event) => {
  recordEvent('pageshow', `persisted=${event.persisted}`)
})
window.addEventListener('focus', () => {
  recordEvent('focus')
})
window.addEventListener('blur', () => {
  recordEvent('blur')
})
