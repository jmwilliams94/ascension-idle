import { useEffect, useState } from 'react'
import CombatEngine from '../game/combat/CombatEngine'
import GlobalActivityConnection from './GlobalActivityConnection'
import QuiverWarningHud from './QuiverWarningHud'
import InventoryFullWarningHud from './InventoryFullWarningHud'
import KnockoutHud from './KnockoutHud'
import PlayersOnlineHud from './PlayersOnlineHud'
import GlobalAnnouncementTicker from './GlobalAnnouncementTicker'
import CombatPage from './CombatPage'
import EquipmentTabPage from './EquipmentTabPage'
import ExpBar from './ExpBar'
import PetToast from './PetToast'
import GainToastHost from './GainToastHost'
import ForgePanel from './ForgePanel'
import InventoryFullModal from './InventoryFullModal'
import MarketplacePanel from './MarketplacePanel'
import OfflineProgressModal from './OfflineProgressModal'
import MoneyBagRevealModal from './MoneyBagRevealModal'
import UnclaimedLootBadge from './UnclaimedLootBadge'
import SettingsModal from './SettingsModal'
import ShopPanel from './ShopPanel'
import TabNav from './TabNav'
import MobileBottomNav from './MobileBottomNav'
import BankPanel from './BankPanel'
import AchievementsPanel from './AchievementsPanel'
import LuckyPanel from './LuckyPanel'
import { useAuthStore } from '../lib/useAuthStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePersistGameState } from '../lib/usePersistGameState'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { useBankStore } from '../game/items/useBankStore'
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
  const loadBankItems = useBankStore((state) => state.loadBankItems)
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
        loadLootHolding(characterId),
        loadMyListings(characterId),
        loadMail(characterId),
        // Bank Storage is account-wide now (2026-08-03, Bank tab rework), so
        // this needs the account id, not the character id — same
        // conditional-spread pattern loadAchievements below already uses for
        // the same reason.
        ...(accountId ? [loadBankItems(accountId), loadAchievements(characterId, accountId)] : []),
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
    loadBankItems,
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
  //
  // Guarded against stacking a second "Welcome back" on top of one the
  // player hasn't dismissed yet (2026-08-05, confirmed with the user — "make
  // sure the first thing that pops up is the correct idle rewards popup and
  // no other nonsense") — without this, a brief app-switcher glance while
  // reviewing the first summary could quietly swap its numbers out from
  // under the player mid-read. Once they've actually dismissed it (result
  // reset to null — see OfflineProgressModal), a genuinely new resume is
  // free to show its own fresh summary again as normal.
  //
  // Three independent triggers now, not just one (2026-08-05, reported by
  // the user: "whenever I have the app minimised [as a Home Screen PWA]...
  // I don't seem to ever get the idle popup... when I re-open it. I usually
  // have to kill the app"). `visibilitychange` alone is well known to be
  // unreliable for iOS/Android standalone home-screen PWAs specifically —
  // WebKit in particular has long-standing quirks where it simply doesn't
  // fire (or fires very late) when a standalone PWA resumes from being
  // backgrounded, unlike an ordinary browser tab, which is exactly the
  // "kill the app to get it to work" pattern being reported. `focus` is a
  // second, differently-implemented signal that's historically more
  // consistent in that exact scenario, so it's added alongside as a fast
  // path. The real fix is the third one below — a heartbeat that doesn't
  // depend on any visibility/lifecycle API firing at all.
  useEffect(() => {
    // In-flight guard (2026-08-09, fixed a real duplicate-reward bug reported
    // by the user: two separate "Welcome back" popups back to back after a
    // long AFK — one currency-only, one item-heavy — from two independent
    // reward batches for the same overlapping away-window). The existing
    // `result !== null` check below only blocks a *second* resume check once
    // the *first* has already finished and shown something — it does nothing
    // against visibilitychange and focus (and occasionally the heartbeat too)
    // all firing within the same tick on one real resume, which each pass
    // that check simultaneously (synchronously, before any of them has
    // `await`ed anything yet) and then race two concurrent resolve-combat
    // calls. The server now also guards against this independently (see
    // resolve-combat/index.ts's compare-and-swap claim on
    // combat_last_resolved_at) but avoiding the redundant call here too
    // means no wasted round-trip.
    let checkInFlight = false

    const checkOfflineProgressOnResume = async () => {
      if (checkInFlight || useOfflineProgressStore.getState().result !== null) {
        return
      }
      checkInFlight = true
      try {
        const offlineResult = await runOfflineProgressCheck(characterId)
        if (offlineResult) {
          useOfflineProgressStore.getState().show(offlineResult)
        }
      } finally {
        checkInFlight = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkOfflineProgressOnResume()
      }
    }
    const handleFocus = () => {
      void checkOfflineProgressOnResume()
    }

    // Browser-quirk-proof fallback, not dependent on visibilitychange/focus
    // firing at all: a JS timer that's been suspended while the app was
    // backgrounded simply doesn't fire while suspended — the moment it
    // resumes, the gap between when this tick *should* have fired (based on
    // its own interval) and when it actually did reveals exactly how long
    // the app was away, using nothing but the wall clock. This is what
    // actually guarantees the popup shows up on a plain re-open, with no
    // dependency on iOS/Android correctly reporting the transition.
    //
    // Gated on document.visibilityState === 'visible' (2026-08-09, fixed a
    // bug reported by the user: minimizing to watch a 10-15min YouTube video
    // and coming back showed no "Welcome back" popup, only a single small
    // item silently in Loot Holding). A merely-backgrounded tab (as opposed
    // to a genuinely suspended one) isn't fully paused by most browsers —
    // this interval keeps firing at a throttled ~once/minute cadence *while
    // still hidden*, which was tripping RESUME_GAP_THRESHOLD_MS on every
    // throttled tick and firing checkOfflineProgressOnResume over and over
    // in the background. Each of those silent calls really did resolve
    // combat and grant rewards (correctly — that's where the stray item
    // came from) but only covered ~60s each, chopping a real 10-15 minute
    // absence into slivers individually too small (or right on the edge) to
    // clear OFFLINE_SUMMARY_THRESHOLD_MS, so the summary modal rarely if
    // ever showed even though the underlying rewards were real. Requiring
    // the tab to actually be visible before treating a gap as a "resume"
    // means the whole away-window accumulates untouched until the player
    // actually looks again, at which point one check covers all of it.
    const HEARTBEAT_INTERVAL_MS = 3000
    const RESUME_GAP_THRESHOLD_MS = 10000
    let lastHeartbeatAt = Date.now()
    const heartbeatId = window.setInterval(() => {
      const now = Date.now()
      const gap = now - lastHeartbeatAt
      lastHeartbeatAt = now
      if (gap > RESUME_GAP_THRESHOLD_MS && document.visibilityState === 'visible') {
        void checkOfflineProgressOnResume()
      }
    }, HEARTBEAT_INTERVAL_MS)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.clearInterval(heartbeatId)
    }
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
      <MoneyBagRevealModal />
      <UnclaimedLootBadge />
      <GainToastHost />
      <CombatEngine />
      <GlobalActivityConnection accountId={accountId} />

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
          <KnockoutHud />
          <PlayersOnlineHud />
          <GlobalAnnouncementTicker />
        </div>

        {/* Renders nothing when there's no pet to celebrate — safe to mount
            unconditionally, same as every other HUD element here. */}
        <PetToast />

        <TabNav />

        <section className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30">
          {activeTab === 'combat' && <CombatPage />}
          {activeTab === 'equipment' && <EquipmentTabPage />}
          {activeTab === 'forge' && <ForgePanel />}
          {activeTab === 'marketplace' && <MarketplacePanel />}
          {activeTab === 'shop' && <ShopPanel />}
          {activeTab === 'bank' && <BankPanel characterId={characterId} />}
          {activeTab === 'achievements' && <AchievementsPanel characterId={characterId} accountId={accountId} />}
          {activeTab === 'lucky' && <LuckyPanel characterId={characterId} />}
        </section>
      </main>

      <MobileBottomNav />
    </div>
  )
}
