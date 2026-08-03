import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Comets (Level Upgrade) and Fallen Stars (Quality Upgrade + weapon sockets later),
// per CLAUDE.md. Deliberately NOT wired into usePersistGameState's autosave: the
// quality_upgrade/level_upgrade Postgres functions and the resolve-combat Edge
// Function already mutate these server-side, so the client only ever reads them
// (on load, and from each call's response) — it must never write them back via
// the generic player-update autosave, or a stale local value could clobber a
// server-side change that happened moments earlier.
//
// Superseded: kill-drop grants used to go through a dedicated grant_currency_reward
// RPC (an atomic increment, called directly from useCombatStore's kill branch).
// That RPC still exists but is no longer called from the client — Comet/
// Fallen Star kill-drops are now resolved as part of resolve-combat's own
// transaction (see resolveCombat.ts), alongside gold/EXP/item drops, rather than
// as a separate call.
//
// Scrolls (stage 2 of the Warehouse economy redesign, 2026-07-31): a compact-
// storage bundle of 10 loose Comets/Fallen Stars into 1 non-stacking Inventory
// item. Same trust model as the units themselves — server-authoritative via
// the bundle_currency_scroll/unbundle_currency_scroll RPCs (SECURITY DEFINER,
// atomic), the client only ever reflects each call's response.
type CurrencyType = 'comet' | 'fallen_star'

interface BundleResult {
  ok: boolean
  error?: string
  unit_count?: number
  scroll_count?: number
}

interface CurrencyState {
  comets: number
  fallenStars: number
  cometScrolls: number
  fallenStarScrolls: number
  // Ascension Points moved to usePlayerRecordStore (2026-08-03) — it's
  // account-wide (a premium currency), not per-character, so it doesn't
  // belong in this store anymore. See usePlayerRecordStore.ts.
  //
  // Bank Storage's own Comet/Fallen Star counts also moved to
  // usePlayerRecordStore (2026-08-03, Bank tab rework) — Storage is now
  // fully account-wide, not per-character, so cometBankCount/
  // fallenStarBankCount live there now too, alongside bankPoints/
  // gearCompositionPoints/stonesBanked.
  hydrate: (saved: { comets: number; fallenStars: number; cometScrolls: number; fallenStarScrolls: number }) => void
  setComets: (value: number) => void
  setFallenStars: (value: number) => void
  setCometScrolls: (value: number) => void
  setFallenStarScrolls: (value: number) => void
  // Bundles 10 loose units into 1 Scroll — one fixed-size transaction per
  // call (mirrors buyArrows/buyPotions always purchasing one full stack),
  // not a variable amount.
  bundleScroll: (characterId: string, currencyType: CurrencyType) => Promise<BundleResult>
  // Unbundles 1 Scroll back into 10 loose units — all-or-nothing, fails with
  // 'not_enough_room' server-side if there isn't space for all 10 rather
  // than partially granting.
  unbundleScroll: (characterId: string, currencyType: CurrencyType) => Promise<BundleResult>
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  comets: 0,
  fallenStars: 0,
  cometScrolls: 0,
  fallenStarScrolls: 0,

  hydrate: (saved) =>
    set({
      comets: saved.comets,
      fallenStars: saved.fallenStars,
      cometScrolls: saved.cometScrolls,
      fallenStarScrolls: saved.fallenStarScrolls,
    }),
  setComets: (value) => set({ comets: value }),
  setFallenStars: (value) => set({ fallenStars: value }),
  setCometScrolls: (value) => set({ cometScrolls: value }),
  setFallenStarScrolls: (value) => set({ fallenStarScrolls: value }),

  bundleScroll: async (characterId, currencyType) => {
    const { data, error } = await supabase.rpc('bundle_currency_scroll', {
      character_id: characterId,
      currency_type: currencyType,
    })

    if (error) {
      console.error('Bundle currency scroll call failed', error)
      return { ok: false }
    }

    const result = data as BundleResult

    if (result.ok && typeof result.unit_count === 'number' && typeof result.scroll_count === 'number') {
      if (currencyType === 'comet') {
        set({ comets: result.unit_count, cometScrolls: result.scroll_count })
      } else {
        set({ fallenStars: result.unit_count, fallenStarScrolls: result.scroll_count })
      }
    }

    return result
  },

  unbundleScroll: async (characterId, currencyType) => {
    const { data, error } = await supabase.rpc('unbundle_currency_scroll', {
      character_id: characterId,
      currency_type: currencyType,
    })

    if (error) {
      console.error('Unbundle currency scroll call failed', error)
      return { ok: false }
    }

    const result = data as BundleResult

    if (result.ok && typeof result.unit_count === 'number' && typeof result.scroll_count === 'number') {
      if (currencyType === 'comet') {
        set({ comets: result.unit_count, cometScrolls: result.scroll_count })
      } else {
        set({ fallenStars: result.unit_count, fallenStarScrolls: result.scroll_count })
      }
    }

    return result
  },
}))
