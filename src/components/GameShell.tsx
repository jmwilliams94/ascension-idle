import { lazy, Suspense, useEffect, useState } from 'react'
import CombatEngine from '../game/combat/CombatEngine'
import RowCombatEngine from '../game/combat/RowCombatEngine'
import MiningEngine from '../game/mining/MiningEngine'
import GlobalActivityConnection from './GlobalActivityConnection'
import MailRealtimeConnection from './MailRealtimeConnection'
import WorldBossConnection from './WorldBossConnection'
import GoldDonationConnection from './GoldDonationConnection'
import TabActivityIndicator from './TabActivityIndicator'
import QuiverWarningHud from './QuiverWarningHud'
import InventoryFullWarningHud from './InventoryFullWarningHud'
import KnockoutHud from './KnockoutHud'
import PlayersOnlineHud from './PlayersOnlineHud'
import VipStatusHud from './VipStatusHud'
import ChatAndAnnouncements from './ChatAndAnnouncements'
import ChatOverlay from './ChatOverlay'
import CharacterLoadoutModal from './CharacterLoadoutModal'
import CombatPage from './CombatPage'
import EquipmentTabPage from './EquipmentTabPage'
import ExpBar from './ExpBar'
import PetToast from './PetToast'
import HuntingTakeoverToast from './HuntingTakeoverToast'
import GainToastHost from './GainToastHost'
import ForgePanel from './ForgePanel'
import InventoryFullModal from './InventoryFullModal'
import MarketplacePanel from './MarketplacePanel'
import OfflineProgressModal from './OfflineProgressModal'
import MoneyBagRevealModal from './MoneyBagRevealModal'
import GearSnapshotClaimModal from './GearSnapshotClaimModal'
import VipSettingsModal from './VipSettingsModal'
import VipAutomationEngine from '../game/vip/VipAutomationEngine'
import SalvageRevealToast from './SalvageRevealToast'
import FireworkOverlay from './FireworkOverlay'
import LevelUpBanner from './LevelUpBanner'
import UnclaimedLootBadge from './UnclaimedLootBadge'
import SettingsModal from './SettingsModal'
import ShopPanel from './ShopPanel'
import TabNav from './TabNav'
import MobileBottomNav from './MobileBottomNav'
import BankPanel from './BankPanel'
import AchievementsPanel from './AchievementsPanel'
import LuckyPanel from './LuckyPanel'
import { useAuthStore } from '../lib/useAuthStore'
import { useIsAdmin } from '../lib/adminConfig'
import { useBugReportStore } from '../game/bugReports/useBugReportStore'
import { useSuggestionStore } from '../game/suggestions/useSuggestionStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePersistGameState } from '../lib/usePersistGameState'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useGearSnapshotStore } from '../game/items/useGearSnapshotStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { useBankStore } from '../game/items/useBankStore'
import { useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { useMarketplaceStore } from '../game/marketplace/useMarketplaceStore'
import { useMailStore } from '../game/marketplace/useMailStore'
import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { AscensionCard } from './ui/AscensionCard'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { runOfflineProgressCheck, OFFLINE_SUMMARY_THRESHOLD_MS } from '../game/combat/offlineProgress'
import { useOfflineProgressStore } from '../game/combat/useOfflineProgressStore'
import { useMineStore } from '../game/mining/useMineStore'
import { useMiningStore } from '../game/mining/useMiningStore'
import { useIdleModeStore } from '../game/mining/useIdleModeStore'
import { runOfflineMiningProgressCheck } from '../game/mining/offlineMiningProgress'

// Lazy (2026-11, bug fix) — WarpLayer pulls in @react-three/fiber + three
// directly (the same heavy toolchain RenderingTestPanel.tsx's own lazy-load
// comment already warns about), and FxLayer's effects pull in html-to-image
// via screenCapture.ts. Both were previously imported eagerly here despite
// being inert until a Settings > FX preview is actually triggered (not wired
// to any real gameplay trigger yet), pushing the main bundle to 2.11MB and
// hard-failing the production build outright (vite-plugin-pwa's Workbox
// precache manifest has a hard 2MiB-per-asset limit, not just a size
// warning). A `null` Suspense fallback is fine — both are invisible overlay
// layers with nothing to show while their code loads.
const FxLayer = lazy(() => import('../game/fx/FxLayer'))
const WarpLayer = lazy(() => import('../game/fx/WarpLayer'))

// Rendered once a character is active (see App.tsx) — everything that was the whole
// app before the character-slots restructure. Account-level concerns (What's New,
// loading the player record/item templates) stay in App.tsx since they don't depend
// on which character is playing.
//
// Full tabbed-page layout (Combat/Equipment/Forge/Market/Shop), replacing the old
// isometric-canvas + overlay-on-canvas pattern — see the Melvor-idle pivot plan.

// One page-identity ribbon per tab, owned here (2026-08-14, requested by the
// user) rather than each tab component wrapping its own content in a second
// AscensionCard — this <section> already provides the one outer
// .ascension-card-frame every tab renders inside (see the return below), so
// a per-page title card was always a redundant second frame nested directly
// inside the first with barely any visible gap. "Idling" for `combat`
// specifically (not "Combat" — TabNav's own nav-button label) since this is
// describing the page's own content, not repeating the nav.
const TAB_TITLES: Record<TabId, string> = {
  combat: 'Idling',
  equipment: 'Equipment',
  forge: 'Forge',
  marketplace: 'Market',
  shop: 'Shop',
  bank: 'Bank',
  achievements: 'Achievements',
  lucky: 'LuckyLad',
}
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
  const loadAllBugReports = useBugReportStore((state) => state.loadAllReports)
  const loadAllSuggestions = useSuggestionStore((state) => state.loadAllSuggestions)
  const activeTab = useTabStore((state) => state.activeTab)
  const accountId = session?.user.id
  const isAdmin = useIsAdmin()

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
        useGearSnapshotStore.getState().loadSnapshots(characterId),
        // Bank Storage is account-wide now (2026-08-03, Bank tab rework), so
        // this needs the account id, not the character id — same
        // conditional-spread pattern loadAchievements below already uses for
        // the same reason.
        ...(accountId ? [loadBankItems(accountId), loadAchievements(characterId, accountId)] : []),
        // Bug Reports' and Suggestions' admin queues (2026-08-21) —
        // eager-loaded only for the admin account so their Settings-sidebar
        // badges (open count) are accurate without having to open the
        // section first; a no-op fetch for everyone else, not worth
        // conditioning out.
        ...(isAdmin ? [loadAllBugReports(), loadAllSuggestions()] : []),
      ])

      if (cancelled) {
        return
      }

      // Hunting and Mining can never both accrue offline progress (confirmed
      // by the user) — last_active_idle_mode decides which single check runs.
      const idleMode = useIdleModeStore.getState().lastActiveIdleMode

      if (idleMode === 'mining') {
        const miningOutcome = await runOfflineMiningProgressCheck(characterId)

        if (cancelled) {
          return
        }

        if (miningOutcome.status === 'shown') {
          useOfflineProgressStore.getState().showMining(miningOutcome.result)
        } else if (miningOutcome.status === 'error') {
          useOfflineProgressStore.getState().showSyncFailed()
        }
      } else {
        // Offline-progress catch-up runs once, before the live fight resumes —
        // reads the *previous* last_active_at (captured by loadCharacterRecord
        // above, before its own saveNow inside here refreshes it) so a quick
        // reload can't double-count the same window. No "Calculating…" spinner
        // for this anymore (Pete's request) — the check itself still runs the
        // same, it just doesn't show a waiting state while in flight.
        const outcome = await runOfflineProgressCheck(characterId)

        if (cancelled) {
          return
        }

        if (outcome.status === 'shown') {
          useOfflineProgressStore.getState().show(outcome.result)
        } else if (outcome.status === 'error') {
          useOfflineProgressStore.getState().showSyncFailed()
        }
      }

      if (cancelled) {
        return
      }

      // Resume whichever mode was last active — a fresh instance, not
      // mid-HP (consistent with how the offline-progress simulator treats a
      // resumed session too). Defensively stops the *other* mode first
      // (2026-08-22, reported by the user — real Hunting knockouts while
      // they believed they were only mining, traced to a missed autosave
      // leaving last_active_idle_mode stale): the fix for the root cause is
      // usePersistGameState.ts now actually persisting mine/idle-mode
      // changes, but this stop() is a second, independent guarantee that
      // Hunting and Mining can never both end up active here even from some
      // other edge case, matching the same mutual-exclusivity CombatPage.tsx's
      // handleFight / MiningModePanel.tsx's handleMine already enforce at
      // the two manual activation points.
      if (idleMode === 'mining') {
        if (useCombatStore.getState().isFighting) {
          useCombatStore.getState().stop()
        }
        const { currentMineId } = useMineStore.getState()
        if (currentMineId && !useMiningStore.getState().isMining) {
          useMiningStore.getState().start(currentMineId)
        }
      } else {
        if (useMiningStore.getState().isMining) {
          useMiningStore.getState().stop()
        }
        const { selectedMonsterId } = useZoneStore.getState()
        if (selectedMonsterId && !useCombatStore.getState().isFighting) {
          useCombatStore.getState().start(selectedMonsterId)
        }
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
    isAdmin,
    loadAllBugReports,
    loadAllSuggestions,
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

    // Set on every hidden transition, cleared once consumed by a resume
    // check (below). CombatEngine keeps its own resolve interval running
    // unconditionally even while backgrounded ("so the fight keeps advancing
    // while the player is on another tab" — see its own comment), so on a
    // plain desktop tab-switch there's usually nothing to catch up: combat
    // kept resolving live the whole time and this will be a same-tick no-op.
    // iOS/Android genuinely suspend JS execution while backgrounded, so a
    // real away period still shows up here as a large gap — the *hidden*
    // transition itself is the reliable half of visibilitychange even on
    // WebKit (it's specifically the *resume* direction that's flaky there,
    // which is why the heartbeat fallback below exists at all). Null means
    // "never observed a clean hidden event" — falls back to lastAliveAt
    // below rather than assuming a real gap (see its own comment for why).
    let hiddenAt: number | null = null

    // Last moment JS was confirmedly still running (updated every heartbeat
    // tick below, while visible). Used as the awayMs baseline whenever
    // hiddenAt is null — i.e. a `focus` event fired without a preceding
    // `visibilitychange`→hidden, which happens on a plain desktop OS-level
    // window switch (alt-tab away and back): the tab itself never leaves
    // `visible` (Page Visibility only tracks tab visibility, not OS window
    // focus), so this interval kept ticking the whole time and lastAliveAt
    // stayed fresh. Previously this case fell back to treating the away-time
    // as Infinity, which always cleared OFFLINE_SUMMARY_THRESHOLD_MS and
    // showed the "Calculating…" spinner even though nothing was missed —
    // reported by the user as the spinner flashing then no popup at all
    // (runOfflineProgressCheck correctly found nothing worth showing, but
    // only after the spinner had already appeared).
    let lastAliveAt = Date.now()

    // Popup cooldown (reported by the user — a second near-identical "Welcome
    // back" splash appeared right after dismissing the first, each covering
    // its own small slice of the same real resume). The three triggers above
    // only guard against firing *simultaneously* (checkInFlight) — they don't
    // stop a later, genuinely separate trigger (e.g. a stray second `focus`
    // event, or just the player taking >60s to read/dismiss the first popup)
    // from finding its own fresh ≥60s-old gap and showing a second full splash
    // moments after the first. Rewards still resolve normally either way —
    // this only suppresses showing another full-screen popup too soon after
    // one was just shown; anything it grants silently still surfaces via
    // UnclaimedLootBadge if left unclaimed. Not persisted (module-level would
    // survive a remount, but a fresh mount already implies enough time has
    // passed that suppressing further is pointless).
    const POPUP_COOLDOWN_MS = 20000
    let lastShownAt: number | null = null

    const checkOfflineProgressOnResume = async () => {
      const offlineProgressState = useOfflineProgressStore.getState()
      if (checkInFlight || offlineProgressState.result !== null || offlineProgressState.miningResult !== null) {
        return
      }
      checkInFlight = true
      const now = Date.now()
      const awayMs = hiddenAt !== null ? now - hiddenAt : now - lastAliveAt
      hiddenAt = null
      const worthShowing = awayMs >= OFFLINE_SUMMARY_THRESHOLD_MS
      const canShowPopup = lastShownAt === null || now - lastShownAt >= POPUP_COOLDOWN_MS
      try {
        // Mirrors the load effect's own branch — Hunting and Mining can
        // never both accrue offline progress.
        if (useIdleModeStore.getState().lastActiveIdleMode === 'mining') {
          const miningOutcome = await runOfflineMiningProgressCheck(characterId)
          if (miningOutcome.status === 'shown' && canShowPopup) {
            lastShownAt = Date.now()
            useOfflineProgressStore.getState().showMining(miningOutcome.result)
          } else if (miningOutcome.status === 'error' && worthShowing && canShowPopup) {
            useOfflineProgressStore.getState().showSyncFailed()
          }
          return
        }
        const outcome = await runOfflineProgressCheck(characterId)
        if (outcome.status === 'shown' && canShowPopup) {
          lastShownAt = Date.now()
          useOfflineProgressStore.getState().show(outcome.result)
        } else if (outcome.status === 'error' && worthShowing && canShowPopup) {
          // Only surface the "couldn't sync" state for a gap that would have
          // been worth showing in the first place — a resolve blip on a
          // trivial few-second tab switch isn't worth an error popup (see
          // runOfflineProgressCheck's own comment on the two outcomes this
          // distinguishes).
          useOfflineProgressStore.getState().showSyncFailed()
        }
      } finally {
        checkInFlight = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkOfflineProgressOnResume()
      } else {
        hiddenAt = Date.now()
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
      lastAliveAt = now
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
    <div className="ascension-page-bg min-h-screen text-slate-100">
      <header className="ascension-edge-b bg-[linear-gradient(180deg,_var(--ascension-ink-soft)_0%,_var(--ascension-ink)_100%)]">
        {/* Single row at every viewport size — no flex-wrap. "Idle Combat"
            removed entirely (it was redundant with the tab the player is
            already on). Revised again 2026-08-14: the 2026-08-02 "no
            gradients" call above is deliberately superseded — the user
            explicitly asked for a full pivot to a gold/steel gradient
            wordmark + glowing star accents (see the gold/steel "Ascension"
            chrome block in src/index.css), confirmed app-wide, not a one-off.
            Steel gradient on "ASCENSION", gold gradient on "IDLE" (keeps
            the established amber-for-IDLE anchor from the old version),
            pulsing gold stars either side. */}
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h1 className="font-heading flex items-center gap-2.5 text-xl font-black tracking-[0.15em] uppercase sm:text-2xl">
            <span className="ascension-glow-pulse text-sm text-amber-400 sm:text-base">✦</span>
            <span className="text-gradient-steel">ASCENSION</span>
            <span className="text-gradient-gold">IDLE</span>
            <span className="ascension-glow-pulse text-sm text-amber-400 sm:text-base">✦</span>
          </h1>

          {/* Icon-only below `lg` (labels hidden via `hidden lg:inline`,
              buttons shrink to a square `p-2` to match Settings' existing
              icon-button shape) — text labels return at `lg`+ alongside
              wider padding. Same row as the heading at every size, right-
              aligned via the parent's justify-between. */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {session?.user.email && <span className="hidden text-sm text-slate-400 lg:inline">{session.user.email}</span>}
            <div className="ascension-chip-frame is-interactive">
              <button
                type="button"
                onClick={() => setActiveCharacterId(null)}
                aria-label="Switch Character"
                title="Switch Character"
                className="ascension-chip-inner flex items-center gap-1.5 p-2 text-slate-300 hover:text-slate-100 lg:px-3 lg:py-1.5"
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
            </div>
            <div className="ascension-chip-frame is-interactive">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
                className="ascension-chip-inner p-2 text-slate-300 hover:text-slate-100"
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
            </div>
            <div className="ascension-chip-frame is-interactive">
              <button
                type="button"
                onClick={() => signOut()}
                aria-label="Sign out"
                title="Sign out"
                className="ascension-chip-inner flex items-center gap-1.5 p-2 text-slate-300 hover:text-slate-100 lg:px-3 lg:py-1.5"
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
        </div>
      </header>

      {settingsOpen && <SettingsModal characterId={characterId} onClose={() => setSettingsOpen(false)} />}
      <InventoryFullModal />
      <OfflineProgressModal />
      <MoneyBagRevealModal />
      <SalvageRevealToast />
      <FireworkOverlay />
      <Suspense fallback={null}>
        <WarpLayer />
        <FxLayer />
      </Suspense>
      <LevelUpBanner />
      <UnclaimedLootBadge />
      <GainToastHost />
      <CombatEngine />
      <RowCombatEngine />
      <MiningEngine />
      <GlobalActivityConnection accountId={accountId} />
      <MailRealtimeConnection characterId={characterId} />
      <WorldBossConnection />
      <GoldDonationConnection />
      <TabActivityIndicator />
      <ChatOverlay characterId={characterId} />
      <CharacterLoadoutModal />
      <GearSnapshotClaimModal />
      <VipSettingsModal />
      <VipAutomationEngine />

      {/* pb-24 (was pb-6, matched by py-6 on lg): clearance for
          MobileBottomNav's fixed bar below `lg` — without it, the bar covers
          whatever's at the bottom of the page's content. Unchanged at `lg`+,
          where the bottom nav doesn't render at all. */}
      <main className="mx-auto max-w-7xl space-y-4 px-6 pb-24 pt-6 lg:pb-6">
        {/* Single flex-wrap row, same as it always was on desktop (lg+) —
            everything fits on one line there and that layout was never
            broken, so it's left untouched at that breakpoint. Below `lg`,
            the warning badges (Quiver/Inventory-full) plus PlayersOnlineHud
            could previously end up competing with ChatAndAnnouncements for
            the same line, shoving things onto a 3rd wrapped line even with
            nothing actually wrong (reported by the user, mobile only). The
            `basis-full lg:hidden` spacer below is a forced line-break that
            only exists below `lg` — it makes ChatAndAnnouncements start a
            fresh line of its own there, without duplicating any component
            or touching the lg+ single-row layout at all. */}
        <div className="flex flex-wrap items-center gap-3">
          <ExpBar />
          <QuiverWarningHud />
          <InventoryFullWarningHud />
          <KnockoutHud />
          <VipStatusHud />
          <PlayersOnlineHud />
          <div className="h-0 basis-full lg:hidden" aria-hidden="true" />
          <ChatAndAnnouncements />
        </div>

        {/* Renders nothing when there's no pet to celebrate — safe to mount
            unconditionally, same as every other HUD element here. */}
        <PetToast />
        <HuntingTakeoverToast />

        <TabNav />

        <AscensionCard title={TAB_TITLES[activeTab]} titleSize="large">
          {activeTab === 'combat' && <CombatPage />}
          {activeTab === 'equipment' && <EquipmentTabPage />}
          {activeTab === 'forge' && <ForgePanel />}
          {activeTab === 'marketplace' && <MarketplacePanel />}
          {activeTab === 'shop' && <ShopPanel />}
          {activeTab === 'bank' && <BankPanel characterId={characterId} />}
          {activeTab === 'achievements' && <AchievementsPanel characterId={characterId} accountId={accountId} />}
          {activeTab === 'lucky' && <LuckyPanel characterId={characterId} />}
        </AscensionCard>
      </main>

      <MobileBottomNav />
    </div>
  )
}
