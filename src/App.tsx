import { useEffect, useState } from 'react'
import AuthGate from './components/AuthGate'
import GameCanvas from './components/GameCanvas'
import HudTabs from './components/HudTabs'
import ProgressionPanel from './components/ProgressionPanel'
import SettingsModal from './components/SettingsModal'
import WhatsNewModal from './components/WhatsNewModal'
import { useAuthStore } from './lib/useAuthStore'
import { usePersistGameState } from './lib/usePersistGameState'
import { usePlayerRecordStore } from './lib/usePlayerRecordStore'

function App() {
  const session = useAuthStore((state) => state.session)
  const signOut = useAuthStore((state) => state.signOut)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loaded = usePlayerRecordStore((state) => state.loaded)
  const whatsNewEntries = usePlayerRecordStore((state) => state.whatsNewEntries)
  const loadPlayerRecord = usePlayerRecordStore((state) => state.loadPlayerRecord)
  const dismissWhatsNew = usePlayerRecordStore((state) => state.dismissWhatsNew)

  const userId = session?.user.id

  useEffect(() => {
    if (userId) {
      loadPlayerRecord(userId)
    }
  }, [userId, loadPlayerRecord])

  usePersistGameState(userId, loaded)

  return (
    <AuthGate>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] text-slate-100">
        <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Greybox Idle v3</p>
              <h1 className="text-xl font-semibold text-white">Isometric movement demo</h1>
            </div>

            <div className="flex items-center gap-3">
              {session?.user.email && <span className="text-sm text-slate-400">{session.user.email}</span>}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
                className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:border-slate-500"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

        {userId && whatsNewEntries && whatsNewEntries.length > 0 && (
          <WhatsNewModal entries={whatsNewEntries} onDismiss={() => dismissWhatsNew(userId)} />
        )}

        <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1.6fr_0.7fr]">
          {/* min-w-0 overrides the grid item's default content-based minimum width — without
              it, any sub-pixel growth in the Phaser canvas forces this 1.6fr track to grow
              and steal space from the 0.7fr sidebar track next to it. */}
          <section className="min-w-0 rounded-3xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30">
            <GameCanvas />
          </section>

          <aside className="space-y-4 rounded-3xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20">
            <div>
              <h2 className="text-lg font-semibold text-white">World HUD</h2>
            </div>

            <ProgressionPanel />

            <HudTabs />
          </aside>
        </main>
      </div>
    </AuthGate>
  )
}

export default App
