import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Meteors (Level Upgrade) and DragonBalls (Quality Upgrade + weapon sockets later),
// per CLAUDE.md. Deliberately NOT wired into usePersistGameState's autosave: the
// quality_upgrade/level_upgrade Postgres functions and the resolve-combat Edge
// Function already mutate these server-side, so the client only ever reads them
// (on load, and from each call's response) — it must never write them back via
// the generic player-update autosave, or a stale local value could clobber a
// server-side change that happened moments earlier.
//
// Superseded: kill-drop grants used to go through a dedicated grant_currency_reward
// RPC (an atomic increment, called directly from useCombatStore's kill branch).
// That RPC still exists but is no longer called from the client — Meteor/
// DragonBall kill-drops are now resolved as part of resolve-combat's own
// transaction (see resolveCombat.ts), alongside gold/EXP/item drops, rather than
// as a separate call.
//
// Scrolls (stage 2 of the Warehouse economy redesign, 2026-07-31): a compact-
// storage bundle of 10 loose Meteors/DragonBalls into 1 non-stacking Inventory
// item. Same trust model as the units themselves — server-authoritative via
// the bundle_currency_scroll/unbundle_currency_scroll RPCs (SECURITY DEFINER,
// atomic), the client only ever reflects each call's response.
type CurrencyType = 'meteor' | 'dragonball'

interface BundleResult {
  ok: boolean
  error?: string
  unit_count?: number
  scroll_count?: number
}

interface CurrencyState {
  meteors: number
  dragonballs: number
  meteorScrolls: number
  dragonballScrolls: number
  // Bank Storage's own Meteor/DragonBall counts (characters.meteor_bank_count/
  // dragonball_bank_count) — confirmed with the user, 2026-08-03. A genuinely
  // separate, parallel option to the existing account-wide currency Bank
  // (players.bank_meteors/bank_dragonballs, via transfer_currency, unchanged):
  // a unit banked this way stays a physical, non-stacking Storage tile, same
  // as loose Meteors/DragonBalls already are in Inventory. Moved between the
  // two via bank_currency_item (see useWarehouseStore), not transfer_currency.
  meteorBankCount: number
  dragonballBankCount: number
  // Ascension Points moved to usePlayerRecordStore (2026-08-03) — it's
  // account-wide (a premium currency), not per-character, so it doesn't
  // belong in this store anymore. See usePlayerRecordStore.ts.
  hydrate: (saved: {
    meteors: number
    dragonballs: number
    meteorScrolls: number
    dragonballScrolls: number
    meteorBankCount: number
    dragonballBankCount: number
  }) => void
  setMeteors: (value: number) => void
  setDragonballs: (value: number) => void
  setMeteorScrolls: (value: number) => void
  setDragonballScrolls: (value: number) => void
  setMeteorBankCount: (value: number) => void
  setDragonballBankCount: (value: number) => void
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
  meteors: 0,
  dragonballs: 0,
  meteorScrolls: 0,
  dragonballScrolls: 0,
  meteorBankCount: 0,
  dragonballBankCount: 0,

  hydrate: (saved) =>
    set({
      meteors: saved.meteors,
      dragonballs: saved.dragonballs,
      meteorScrolls: saved.meteorScrolls,
      dragonballScrolls: saved.dragonballScrolls,
      meteorBankCount: saved.meteorBankCount,
      dragonballBankCount: saved.dragonballBankCount,
    }),
  setMeteors: (value) => set({ meteors: value }),
  setDragonballs: (value) => set({ dragonballs: value }),
  setMeteorScrolls: (value) => set({ meteorScrolls: value }),
  setDragonballScrolls: (value) => set({ dragonballScrolls: value }),
  setMeteorBankCount: (value) => set({ meteorBankCount: value }),
  setDragonballBankCount: (value) => set({ dragonballBankCount: value }),

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
      if (currencyType === 'meteor') {
        set({ meteors: result.unit_count, meteorScrolls: result.scroll_count })
      } else {
        set({ dragonballs: result.unit_count, dragonballScrolls: result.scroll_count })
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
      if (currencyType === 'meteor') {
        set({ meteors: result.unit_count, meteorScrolls: result.scroll_count })
      } else {
        set({ dragonballs: result.unit_count, dragonballScrolls: result.scroll_count })
      }
    }

    return result
  },
}))
