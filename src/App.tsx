import { lazy, Suspense, useEffect, useRef } from 'react'
import AuthGate from './components/AuthGate'
import RotateDeviceOverlay from './components/RotateDeviceOverlay'
import SessionConflictModal from './components/SessionConflictModal'
import SessionEvictedToast from './components/SessionEvictedToast'
import UpdateBanner from './components/UpdateBanner'
import StaleClientNotice from './components/StaleClientNotice'
import WhatsNewModal from './components/WhatsNewModal'
import { useAuthStore } from './lib/useAuthStore'
import { useActiveCharacterStore, getStoredCharacterId, setStoredCharacterId } from './lib/useActiveCharacterStore'
import { usePlayerRecordStore } from './lib/usePlayerRecordStore'
import { useItemTemplatesStore } from './game/items/useItemTemplatesStore'
import { usePromotionStore } from './game/items/usePromotionStore'
import { useSessionConflictStore } from './game/social/useSessionConflictStore'

// Split out of the main bundle (2026-09-02) -- these two pull in the entire
// game engine (combat/forge/inventory/market/mining, all item/zone/monster
// data catalogs) and were previously static imports, so that whole ~1.3MB
// chunk was downloaded and evaluated even on the login screen, before any
// session exists to use it. Diagnosed as a likely contributor to an iOS
// WKWebView memory-pressure kill+relaunch happening on the login screen
// (reported by the user, evidenced by a debug trail showing a page reload
// with no pagehide/beforeunload at all -- the signature of an abrupt OS-level
// process kill, not a normal navigation or any reload our own code triggers).
const GameShell = lazy(() => import('./components/GameShell'))
const CharacterSelectScreen = lazy(() => import('./components/CharacterSelectScreen'))

function App() {
  const session = useAuthStore((state) => state.session)
  const userId = session?.user.id

  const loadPlayerRecord = usePlayerRecordStore((state) => state.loadPlayerRecord)
  const whatsNewEntries = usePlayerRecordStore((state) => state.whatsNewEntries)
  const dismissWhatsNew = usePlayerRecordStore((state) => state.dismissWhatsNew)
  const loadTemplates = useItemTemplatesStore((state) => state.loadTemplates)
  const loadPromotionTiers = usePromotionStore((state) => state.loadTiers)

  const characterId = useActiveCharacterStore((state) => state.characterId)
  const setActiveCharacterId = useActiveCharacterStore((state) => state.setActiveCharacterId)

  const evictedByOther = useSessionConflictStore((state) => state.evictedByOther)

  // Guards the one-time "resume last-played character" attempt below so it only
  // fires once per fresh mount (i.e. a real page load) — not every time
  // characterId happens to become null, which would fight the "Switch Character"
  // button (that's a deliberate action, it shouldn't immediately re-resume).
  const hasAttemptedResume = useRef(false)

  // Best-effort real orientation lock, on top of the manifest's
  // `orientation: 'portrait-primary'` hint (only honored for an installed/
  // standalone PWA, and only on browsers that support it — Chrome/Android
  // mainly). Fails silently everywhere else (iOS Safari has no lock API at
  // all; a plain browser tab isn't allowed to lock without user-initiated
  // fullscreen) — RotateDeviceOverlay below is the fallback that actually
  // covers those cases.
  useEffect(() => {
    void screen.orientation?.lock?.('portrait-primary').catch(() => {})
  }, [])

  // Gated on userId (2026-09-02, was unconditional) -- these load the same
  // heavy item/promotion data catalogs GameShell needs, no reason to fetch or
  // hold them in memory before a session exists to use them.
  useEffect(() => {
    if (userId) {
      loadTemplates()
    }
  }, [userId, loadTemplates])

  useEffect(() => {
    if (userId) {
      loadPromotionTiers()
    }
  }, [userId, loadPromotionTiers])

  useEffect(() => {
    if (userId) {
      loadPlayerRecord(userId)
    }
  }, [userId, loadPlayerRecord])

  // Signing out (or losing the session) always returns to character select on the
  // next login within this tab session, rather than skipping back into whatever
  // character was last active.
  useEffect(() => {
    if (!session) {
      setActiveCharacterId(null)
    }
  }, [session, setActiveCharacterId])

  // Another tab/device confirmed the "sign out other session" prompt (see
  // GlobalActivityConnection.tsx's broadcast listener and
  // SessionConflictModal.tsx) -- sign this session out so it stops polling
  // combat. SessionEvictedToast (mounted below, outside GameShell) stays up
  // through the resulting unmount to explain why.
  useEffect(() => {
    if (evictedByOther) {
      void useAuthStore.getState().signOut()
    }
  }, [evictedByOther])

  // Resumes the last-played character on a fresh page load (once per mount), then
  // keeps localStorage in sync with every subsequent change — selecting a different
  // character, or clearing it via "Switch Character". The guard ref matters here:
  // without it, this effect would immediately overwrite storage with `null` on the
  // very first render (before the resume attempt's state update has landed).
  useEffect(() => {
    if (!userId) {
      return
    }

    if (!hasAttemptedResume.current) {
      hasAttemptedResume.current = true
      const stored = getStoredCharacterId(userId)

      if (stored) {
        setActiveCharacterId(stored)
        return
      }
    }

    setStoredCharacterId(userId, characterId)
  }, [userId, characterId, setActiveCharacterId])

  return (
    <>
      <RotateDeviceOverlay />
      <UpdateBanner />
      <StaleClientNotice />
      <SessionConflictModal />
      <SessionEvictedToast />

      <AuthGate>
        {userId && whatsNewEntries && whatsNewEntries.length > 0 && (
          <WhatsNewModal entries={whatsNewEntries} onDismiss={() => dismissWhatsNew(userId)} />
        )}

        <Suspense
          fallback={
            <div className="ascension-page-bg flex min-h-screen items-center justify-center">
              <p className="font-heading text-heading-label ascension-glow-pulse text-base">Loading…</p>
            </div>
          }
        >
          {characterId ? <GameShell characterId={characterId} /> : <CharacterSelectScreen />}
        </Suspense>
      </AuthGate>
    </>
  )
}

export default App
