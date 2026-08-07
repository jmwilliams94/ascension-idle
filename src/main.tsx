import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { useAppUpdateStore } from './lib/useAppUpdateStore'

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
  onNeedRefresh: () => useAppUpdateStore.getState().setNeedRefresh(true),
  onRegisteredSW(_url, registration) {
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
