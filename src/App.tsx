import { useEffect } from 'react'
import AuthGate from './components/AuthGate'
import CharacterSelectScreen from './components/CharacterSelectScreen'
import GameShell from './components/GameShell'
import WhatsNewModal from './components/WhatsNewModal'
import { useAuthStore } from './lib/useAuthStore'
import { useActiveCharacterStore } from './lib/useActiveCharacterStore'
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

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    if (userId) {
      loadPlayerRecord(userId)
    }
  }, [userId, loadPlayerRecord])

  // Signing out (or losing the session) always returns to character select on the
  // next login, rather than skipping back into whatever character was last active.
  useEffect(() => {
    if (!session) {
      setActiveCharacterId(null)
    }
  }, [session, setActiveCharacterId])

  return (
    <AuthGate>
      {userId && whatsNewEntries && whatsNewEntries.length > 0 && (
        <WhatsNewModal entries={whatsNewEntries} onDismiss={() => dismissWhatsNew(userId)} />
      )}

      {characterId ? <GameShell characterId={characterId} /> : <CharacterSelectScreen />}
    </AuthGate>
  )
}

export default App
