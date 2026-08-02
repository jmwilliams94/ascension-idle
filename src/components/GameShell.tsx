import { useEffect, useState } from 'react'
import CombatEngine from '../game/combat/CombatEngine'
import QuiverWarningHud from './QuiverWarningHud'
import InventoryFullWarningHud from './InventoryFullWarningHud'
import CombatPage from './CombatPage'
import EquipmentTabPage from './EquipmentTabPage'
import ExpBar from './ExpBar'
import ForgePanel from './ForgePanel'
import InventoryFullModal from './InventoryFullModal'
import MarketplacePanel from './MarketplacePanel'
import OfflineProgressModal from './OfflineProgressModal'
import SettingsModal from './SettingsModal'
import ShopPanel from './ShopPanel'
import TabNav from './TabNav'
import MobileBottomNav from './MobileBottomNav'
import WarehousePanel from './WarehousePanel'
import AchievementsPanel from './AchievementsPanel'
import LuckyPanel from './LuckyPanel'
import { useAuthStore } from '../lib/useAuthStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePersistGameState } from '../lib/usePersistGameState'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { useWarehouseStore } from '../game/items/useWarehouseStore'
import { useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { useMarketplaceStore } from '../game/marketplace/useMarketplaceStore'
import { useMailStore } from '../game/marketplace/useMailStore'
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
  const loadPotionStacks = usePotionStore((state) => state.loadStacks)
  const loadWarehouseItems = useWarehouseStore((state) => state.loadWarehouseItems)
  const loadLootHolding = useLootHoldingStore((state) => state.loadLootHolding)
  const loadAchievements = useAchievementsStore((state) => state.loadAchievements)
  const loadMyListings = useMarketplaceStore((state) => state.loadMyListings)
  const loadMail = useMailStore((state) => state.loadMail)
  const activeTab = useTabStore((state) => state.activeTab)
  const accountId = session?.user.id

  useEffect(() => {
    let cancelled = false

    async function load() {
      await Promise.all([
        loadCharacterRecord(characterId),
        loadInventory(characterId),
        loadPotionStacks(characterId),
        loadWarehouseItems(characterId),
        loadLootHolding(characterId),
        loadMyListings(characterId),
        loadMail(characterId),
        ...(accountId ? [loadAchievements(characterId, accountId)] : []),
      ])

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
  }, [
    characterId,
    loadCharacterRecord,
    loadInventory,
    loadPotionStacks,
    loadWarehouseItems,
    loadLootHolding,
    loadAchievements,
    loadMyListings,
    loadMail,
    accountId,
  ])

  // Re-run the offline-progress check whenever the app comes back to the
  // foreground, not just once at mount — fixes a bug where minimizing/
  // backgrounding the app (mobile PWA, switching tabs) never triggered the
  // "welcome back" summary at all, only a genuine force-quit-and-relaunch
  // did (which remounts GameShell, re-running the load effect above from
  // scratch). CombatEngine already resolves live combat when visibility goes
  // *hidden* (closing out the window right before backgrounding, so
  // combat_last_resolved_at accurately marks when the away-time starts) —
  // this is that flow's missing other half, resolving the *offline* window
  // when visibility comes back. runOfflineProgressCheck's own
  // OFFLINE_SUMMARY_THRESHOLD_MS guard means a brief app-switcher glance
  // just quietly returns null here — safe to call on every resume.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      void (async () => {
        const offlineResult = await runOfflineProgressCheck(characterId)
        if (offlineResult) {
          useOfflineProgressStore.getState().show(offlineResult)
        }
      })()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [characterId])

  usePersistGameState(characterId, loaded)

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] text-slate-100">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        {/* Single row at every viewport size — no flex-wrap. "Idle Combat"
            removed entirely (it was redundant with the tab the player is
            already on). Revised (2026-08-02, per the user's direct feedback
            that a gradient badge + gradient-text wordmark read as "cheap"):
            no badge, no multi-stop gradient — just the same uppercase-
            tracking eyebrow style the old two-line header already used,
            scaled up into the sole heading, with the game's one established
            accent color (the amber already used for Gold/the PWA icon)
            restrained to "IDLE" rather than painted across the whole thing. */}
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h1 className="text-xl font-bold tracking-[0.15em] text-slate-100 sm:text-2xl">
            ASCENSION <span className="text-amber-400">IDLE</span>
          </h1>

          {/* Icon-only below `lg` (labels hidden via `hidden lg:inline`,
              buttons shrink to a square `p-2` to match Settings' existing
              icon-button shape) — text labels return at `lg`+ alongside
              wider padding. Same row as the heading at every size, right-
              aligned via the parent's justify-between. */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {session?.user.email && <span className="hidden text-sm text-slate-400 lg:inline">{session.user.email}</span>}
            <button
              type="button"
              onClick={() => setActiveCharacterId(null)}
              aria-label="Switch Character"
              title="Switch Character"
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 p-2 text-slate-300 hover:border-slate-500 lg:px-3 lg:py-1.5"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0"
              >
                <path d="m17 2 4 4-4 4" />
                <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                <path d="m7 22-4-4 4-4" />
                <path d="M21 13v1a4 4 0 0 1-4 4H3" />
              </svg>
              <span className="hidden text-sm lg:inline">Switch Character</span>
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
              aria-label="Sign out"
              title="Sign out"
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 p-2 text-slate-300 hover:border-slate-500 lg:px-3 lg:py-1.5"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="hidden text-sm lg:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <InventoryFullModal />
      <OfflineProgressModal />
      <CombatEngine />

      {/* pb-24 (was pb-6, matched by py-6 on lg): clearance for
          MobileBottomNav's fixed bar below `lg` — without it, the bar covers
          whatever's at the bottom of the page's content. Unchanged at `lg`+,
          where the bottom nav doesn't render at all. */}
      <main className="mx-auto max-w-7xl space-y-4 px-6 pb-24 pt-6 lg:pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <ExpBar />
          </div>
          <QuiverWarningHud />
          <InventoryFullWarningHud />
        </div>

        <TabNav />

        <section className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30">
          {activeTab === 'combat' && <CombatPage />}
          {activeTab === 'equipment' && <EquipmentTabPage />}
          {activeTab === 'forge' && <ForgePanel />}
          {activeTab === 'marketplace' && <MarketplacePanel />}
          {activeTab === 'shop' && <ShopPanel />}
          {activeTab === 'warehouse' && <WarehousePanel characterId={characterId} />}
          {activeTab === 'achievements' && <AchievementsPanel characterId={characterId} />}
          {activeTab === 'lucky' && <LuckyPanel />}
        </section>
      </main>

      <MobileBottomNav />
    </div>
  )
}
