import { useEffect, useState } from 'react'
import CombatEngine from '../game/combat/CombatEngine'
import ArrowCounterHud from './ArrowCounterHud'
import CombatPage from './CombatPage'
import EquipmentTabPage from './EquipmentTabPage'
import ExpBar from './ExpBar'
import ForgePanel from './ForgePanel'
import InventoryFullModal from './InventoryFullModal'
import MarketplacePanel from './MarketplacePanel'
import OfflineProgressModal from './OfflineProgressModal'
import ProgressionPanel from './ProgressionPanel'
import SettingsModal from './SettingsModal'
import ShopPanel from './ShopPanel'
import TabNav from './TabNav'
import { useAuthStore } from '../lib/useAuthStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePersistGameState } from '../lib/usePersistGameState'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useTabStore } from '../game/hud/useTabStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { runOfflineProgressCheck } from '../game/combat/offlineProgress'
import { useOfflineProgressStore } from '../game/combat/useOfflineProgressStore'

// Rendered once a character is active (see App.tsx) — everything that was the whole
// app before the character-slots restructure. Account-level concerns (What's New,
// loading the player record/item templates) stay in App.tsx since they don't depend
// on which character is playing.
//
// Full tabbed-page layout (Combat/Equipment/Forge/Market/Shop), replacing the old
// isometric-canvas + overlay-on-canvas pattern — see the Melvor-idle pivot plan.
export default function GameShell({ characterId }: { characterId: string }) {
  const session = useAuthStore((state) => state.session)
  const signOut = useAuthStore((state) => state.signOut)
  const setActiveCharacterId = useActiveCharacterStore((state) => state.setActiveCharacterId)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loaded = useCharacterRecordStore((state) => state.loaded)
  const loadCharacterRecord = useCharacterRecordStore((state) => state.loadCharacterRecord)
  const loadInventory = useInventoryStore((state) => state.loadInventory)
  const loadArrowStacks = useArrowStore((state) => state.loadStacks)
  const activeTab = useTabStore((state) => state.activeTab)

  useEffect(() => {
    let cancelled = false

    async function load() {
      await Promise.all([loadCharacterRecord(characterId), loadInventory(characterId), loadArrowStacks(characterId)])

      if (cancelled) {
        return
      }

      // Offline-progress catch-up runs once, before the live fight resumes —
      // reads the *previous* last_active_at (captured by loadCharacterRecord
      // above, before its own saveNow inside here refreshes it) so a quick
      // reload can't double-count the same window.
      const offlineResult = await runOfflineProgressCheck(characterId)

      if (cancelled) {
        return
      }

      if (offlineResult) {
        useOfflineProgressStore.getState().show(offlineResult)
      }

      // Resume the live fight against whatever monster was last selected — a fresh
      // instance, not mid-HP (consistent with how the offline-progress simulator
      // treats a resumed session too).
      const { selectedMonsterId } = useZoneStore.getState()
      if (selectedMonsterId && !useCombatStore.getState().isFighting) {
        useCombatStore.getState().start(selectedMonsterId)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [characterId, loadCharacterRecord, loadInventory, loadArrowStacks])

  usePersistGameState(characterId, loaded)

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] text-slate-100">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Greybox Idle</p>
            <h1 className="text-xl font-semibold text-white">Idle Combat</h1>
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
      <InventoryFullModal />
      <OfflineProgressModal />
      <CombatEngine />

      <main className="mx-auto max-w-7xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <ExpBar />
          </div>
          <ArrowCounterHud />
        </div>

        <ProgressionPanel />

        <TabNav />

        <section className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30">
          {activeTab === 'combat' && <CombatPage />}
          {activeTab === 'equipment' && <EquipmentTabPage />}
          {activeTab === 'forge' && <ForgePanel />}
          {activeTab === 'marketplace' && <MarketplacePanel />}
          {activeTab === 'shop' && <ShopPanel />}
        </section>
      </main>
    </div>
  )
}
