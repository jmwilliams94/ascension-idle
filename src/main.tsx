import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { useAppUpdateStore } from './lib/useAppUpdateStore'
import { recordEvent } from './lib/debugTrail'

// Prompt-based update (was silent autoUpdate) — a new build installs in the
// background, then UpdateBanner.tsx shows a "Refresh" prompt instead of
// silently taking over on the player's next natural reload. See CLAUDE.md's
// "PWA & Mobile" section.
//
// registerSW only checks for a new service worker once, at initial
// registration — an already-open tab (the common case for an idle game)
// would otherwise never learn about a later deploy. onRegisteredSW polls
// registration.update() every UPDATE_CHECK_INTERVAL_MS so a long-lived
// session still picks it up; registration.update()'s own fetch of sw.js is
// spec-mandated cache: 'no-store', so this isn't defeated by HTTP caching.
const UPDATE_CHECK_INTERVAL_MS = 60_000

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => {
    recordEvent('sw:need-refresh')
    useAppUpdateStore.getState().setNeedRefresh(true)
  },
  // vite-plugin-pwa's own default here (when this isn't provided) is an
  // unconditional window.location.reload() the instant the new service
  // worker becomes the controller -- which can happen with no user action at
  // all whenever the *old* worker naturally loses its last client (e.g. an
  // installed PWA getting torn down by iOS while backgrounded, then
  // relaunched). That silently reloaded the page mid-interaction -- e.g.
  // right as a native autofill sheet was up -- looking like a jarring,
  // repeating refresh loop (reported by the user, 2026-09-02). Only reload
  // when the player actually clicked UpdateBanner's Refresh button
  // (useAppUpdateStore's applyUpdate sets `refreshing` before doing anything
  // else) -- an unprompted activation just lets the new worker quietly take
  // over for the next real navigation instead.
  onNeedReload: () => {
    const refreshing = useAppUpdateStore.getState().refreshing
    recordEvent('sw:need-reload', `refreshing=${refreshing}`)
    if (refreshing) {
      window.location.reload()
    }
  },
  onRegisteredSW(_url, registration) {
    recordEvent('sw:registered', `hasRegistration=${Boolean(registration)}`)
    if (!registration) {
      return
    }
    setInterval(() => {
      void registration.update()
    }, UPDATE_CHECK_INTERVAL_MS)
  },
})
useAppUpdateStore.getState().setUpdateSW(updateSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
