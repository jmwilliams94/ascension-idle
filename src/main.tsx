import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Silent auto-update: a new build takes over in the background and applies
// on the player's next natural reload — no "update available" prompt UI.
// See CLAUDE.md's "PWA & Mobile" section.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
