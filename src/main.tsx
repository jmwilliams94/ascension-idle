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
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => useAppUpdateStore.getState().setNeedRefresh(true),
})
useAppUpdateStore.getState().setUpdateSW(updateSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
