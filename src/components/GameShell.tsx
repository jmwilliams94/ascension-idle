import { useEffect, useState } from 'react'
import ArrowCounterHud from './ArrowCounterHud'
import BottomNav from './BottomNav'
import GameCanvas from './GameCanvas'
import HudTabs from './HudTabs'
import ProgressionPanel from './ProgressionPanel'
import SettingsModal from './SettingsModal'
import ShopOverlay from './ShopOverlay'
import { useAuthStore } from '../lib/useAuthStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePersistGameState } from '../lib/usePersistGameState'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useShopStore } from '../game/hud/useShopStore'

// Rendered once a character is active (see App.tsx) — everything that was the whole
// app before the character-slots restructure. Account-level concerns (What's New,
// loading the player record/item templates) stay in App.tsx since they don't depend
// on which character is playing.
export default function GameShell({ characterId }: { characterId: string }) {
  const session = useAuthStore((state) => state.session)
  const signOut = useAuthStore((state) => state.signOut)
  const setActiveCharacterId = useActiveCharacterStore((state) => state.setActiveCharacterId)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loaded = useCharacterRecordStore((state) => state.loaded)
  const loadCharacterRecord = useCharacterRecordStore((state) => state.loadCharacterRecord)
  const loadInventory = useInventoryStore((state) => state.loadInventory)
  const loadArrowStacks = useArrowStore((state) => state.loadStacks)
  const shopOpen = useShopStore((state) => state.isOpen)

  useEffect(() => {
    loadCharacterRecord(characterId)
    loadInventory(characterId)
    loadArrowStacks(characterId)
  }, [characterId, loadCharacterRecord, loadInventory, loadArrowStacks])

  usePersistGameState(characterId, loaded)

  return (
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
              onClick={() => setActiveCharacterId(null)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
            >
              Switch Character
            </button>
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

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1.6fr_0.7fr]">
        {/* min-w-0 overrides the grid item's default content-based minimum width — without
            it, any sub-pixel growth in the Phaser canvas forces this 1.6fr track to grow
            and steal space from the 0.7fr sidebar track next to it. */}
        <section className="min-w-0 rounded-3xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30">
          <div className="relative">
            <GameCanvas />
            <ArrowCounterHud />
            {shopOpen && <ShopOverlay />}
          </div>

          <BottomNav />
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
  )
}
