import { useEffect, useRef } from 'react'
import AuthGate from './components/AuthGate'
import CharacterSelectScreen from './components/CharacterSelectScreen'
import GameShell from './components/GameShell'
import UpdateBanner from './components/UpdateBanner'
import WhatsNewModal from './components/WhatsNewModal'
import { useAuthStore } from './lib/useAuthStore'
import { useActiveCharacterStore, getStoredCharacterId, setStoredCharacterId } from './lib/useActiveCharacterStore'
import { usePlayerRecordStore } from './lib/usePlayerRecordStore'
import { useItemTemplatesStore } from './game/items/useItemTemplatesStore'

function App() {
  const session = useAuthStore((state) => state.session)
  const userId = session?.user.id

  const loadPlayerRecord = usePlayerRecordStore((state) => state.loadPlayerRecord)
  const whatsNewEntries = usePlayerRecordStore((state) => state.whatsNewEntries)
  const dismissWhatsNew = usePlayerRecordStore((state) => state.dismissWhatsNew)
  const loadTemplates = useItemTemplatesStore((state) => state.loadTemplates)

  const characterId = useActiveCharacterStore((state) => state.characterId)
  const setActiveCharacterId = useActiveCharacterStore((state) => state.setActiveCharacterId)

  // Guards the one-time "resume last-played character" attempt below so it only
  // fires once per fresh mount (i.e. a real page load) — not every time
  // characterId happens to become null, which would fight the "Switch Character"
  // button (that's a deliberate action, it shouldn't immediately re-resume).
  const hasAttemptedResume = useRef(false)

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

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
      <UpdateBanner />

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
