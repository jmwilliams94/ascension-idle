import { useEffect, useRef } from 'react'
import AuthGate from './components/AuthGate'
import CharacterSelectScreen from './components/CharacterSelectScreen'
import GameShell from './components/GameShell'
import RotateDeviceOverlay from './components/RotateDeviceOverlay'
import SessionConflictModal from './components/SessionConflictModal'
import SessionEvictedToast from './components/SessionEvictedToast'
import UpdateBanner from './components/UpdateBanner'
import WhatsNewModal from './components/WhatsNewModal'
import { useAuthStore } from './lib/useAuthStore'
import { useActiveCharacterStore, getStoredCharacterId, setStoredCharacterId } from './lib/useActiveCharacterStore'
import { usePlayerRecordStore } from './lib/usePlayerRecordStore'
import { useItemTemplatesStore } from './game/items/useItemTemplatesStore'
import { usePromotionStore } from './game/items/usePromotionStore'
import { useSessionConflictStore } from './game/social/useSessionConflictStore'

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

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    loadPromotionTiers()
  }, [loadPromotionTiers])

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
      <SessionConflictModal />
      <SessionEvictedToast />

      <AuthGate>
        {userId && whatsNewEntries && whatsNewEntries.length > 0 && (
          <WhatsNewModal entries={whatsNewEntries} onDismiss={() => dismissWhatsNew(userId)} />
        )}

        {characterId ? <GameShell characterId={characterId} /> : <CharacterSelectScreen />}
      </AuthGate>
    </>
  )
}

export default App
