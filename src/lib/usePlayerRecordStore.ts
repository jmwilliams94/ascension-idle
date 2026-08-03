import { create } from 'zustand'
import { changelogEntriesAfter, type ChangelogEntry } from './changelog'
import { compareVersions } from './semver'
import { supabase } from './supabaseClient'
import { APP_VERSION } from '../version'
import { DEFAULT_GEAR_COMPOSITION_POINTS, type GearCompositionPoints } from '../game/items/forgeCosts'
import type { CompositionStones } from '../game/items/useCompositionStore'

const DEFAULT_STONES_BANKED: CompositionStones = { '1': 0, '2': 0, '3': 0, '4': 0 }

// Account-level only — class/level/gold/exp/zone/equipped/meteors/dragonballs all
// moved to the characters table (see useCharacterRecordStore) as part of the
// character-slots restructure. This store now only concerns itself with things that
// apply to the whole account, not any one character.
interface PlayerRow {
  last_seen_version: string | null
  bank_gold: number
  bank_meteors: number
  bank_dragonballs: number
  unlocked_classes: string[]
  ascension_points: number
  warehouse_points: number
  gear_composition_points: GearCompositionPoints
  meteor_bank_count: number
  dragonball_bank_count: number
  composition_stones_banked: CompositionStones
}

interface PlayerRecordState {
  // False until loadPlayerRecord's initial fetch has finished.
  loaded: boolean
  // Entries to show in the "What's New" modal. Null means nothing to show (either
  // not loaded yet, already up to date, or already dismissed this session).
  whatsNewEntries: ChangelogEntry[] | null
  // Shared account-wide bank (Warehouse's currency section) — deposited/withdrawn
  // via transfer_currency (see useWarehouseStore), never written directly by the
  // client, same trust model as meteors/dragonballs on the character row.
  bankGold: number
  bankMeteors: number
  bankDragonballs: number
  // Account-wide class-unlock milestones (e.g. a Hunter reaching max level), not
  // per-character. Only 'hunter' by default until a real unlock mechanic exists.
  unlockedClasses: string[]
  // Ascension Points (2026-08-03) — a premium currency, account-wide by design
  // (confirmed with the user, corrects an earlier per-character version):
  // earned only via sell_item/sell_loot_holding's ap_gained, spent only via
  // the Marketplace RPCs. Unlike bank_gold/bank_meteors/bank_dragonballs
  // there's no separate per-character wallet for this at all — one shared
  // balance, same shape as unlockedClasses above rather than a wallet/bank
  // pair. Server-authoritative — never written except to reflect an RPC's
  // response.
  ascensionPoints: number
  // Bank tab rework (2026-08-03, confirmed with the user) — Storage becomes
  // fully account-wide, not just the points pools: warehouse_points/
  // gear_composition_points (the two liquidation pools) and meteor_bank_count/
  // dragonball_bank_count/composition_stones_banked (the physical Bank
  // Storage counts) all moved from characters to players in the same
  // migration that removed the dead legacy warehouse_items token system. See
  // useWarehouseStore.ts for the RPC wrappers that mutate these.
  warehousePoints: number
  gearCompositionPoints: GearCompositionPoints
  meteorBankCount: number
  dragonballBankCount: number
  stonesBanked: CompositionStones
  loadPlayerRecord: (userId: string) => Promise<void>
  dismissWhatsNew: (userId: string) => Promise<void>
  // Reflects a successful transfer_currency RPC result in the local cache —
  // mirrors useCurrencyStore's setMeteors/setDragonballs pattern.
  setBankBalances: (patch: Partial<{ bankGold: number; bankMeteors: number; bankDragonballs: number }>) => void
  setAscensionPoints: (value: number) => void
  // Incremental, not absolute — used specifically for sell_item/
  // sell_loot_holding's ap_gained, since Shop's bulk-sell fires many sell
  // calls in parallel (Promise.all); an absolute set from each response could
  // let an out-of-order-arriving response clobber a later one.
  addAscensionPoints: (amount: number) => void
  setWarehousePoints: (value: number) => void
  setGearCompositionPoints: (value: GearCompositionPoints) => void
  setMeteorBankCount: (value: number) => void
  setDragonballBankCount: (value: number) => void
  setStonesBanked: (value: CompositionStones) => void
}

export const usePlayerRecordStore = create<PlayerRecordState>((set) => ({
  loaded: false,
  whatsNewEntries: null,
  bankGold: 0,
  bankMeteors: 0,
  bankDragonballs: 0,
  unlockedClasses: ['hunter'],
  ascensionPoints: 0,
  warehousePoints: 0,
  gearCompositionPoints: DEFAULT_GEAR_COMPOSITION_POINTS,
  meteorBankCount: 0,
  dragonballBankCount: 0,
  stonesBanked: DEFAULT_STONES_BANKED,

  loadPlayerRecord: async (userId) => {
    const { data, error } = await supabase
      .from('players')
      .select(
        'last_seen_version, bank_gold, bank_meteors, bank_dragonballs, unlocked_classes, ascension_points, warehouse_points, gear_composition_points, meteor_bank_count, dragonball_bank_count, composition_stones_banked',
      )
      .eq('id', userId)
      .maybeSingle<PlayerRow>()

    if (error) {
      console.error('Failed to load player record', error)
      return
    }

    if (!data) {
      // Genuinely new account — create their row with defaults, skip the What's New popup.
      const { error: insertError } = await supabase.from('players').insert({
        id: userId,
        last_seen_version: APP_VERSION,
      })

      if (insertError) {
        console.error('Failed to create new player record', insertError)
      }

      set({
        loaded: true,
        whatsNewEntries: null,
        bankGold: 0,
        bankMeteors: 0,
        bankDragonballs: 0,
        unlockedClasses: ['hunter'],
        ascensionPoints: 0,
        warehousePoints: 0,
        gearCompositionPoints: DEFAULT_GEAR_COMPOSITION_POINTS,
        meteorBankCount: 0,
        dragonballBankCount: 0,
        stonesBanked: DEFAULT_STONES_BANKED,
      })
      return
    }

    set({
      bankGold: data.bank_gold,
      bankMeteors: data.bank_meteors,
      bankDragonballs: data.bank_dragonballs,
      unlockedClasses: data.unlocked_classes,
      ascensionPoints: data.ascension_points,
      warehousePoints: data.warehouse_points,
      gearCompositionPoints: data.gear_composition_points,
      meteorBankCount: data.meteor_bank_count,
      dragonballBankCount: data.dragonball_bank_count,
      stonesBanked: data.composition_stones_banked,
    })

    if (!data.last_seen_version) {
      // Row predates version tracking (or somehow has none) — record it silently.
      await supabase.from('players').update({ last_seen_version: APP_VERSION }).eq('id', userId)
      set({ loaded: true, whatsNewEntries: null })
      return
    }

    const whatsNewEntries =
      compareVersions(data.last_seen_version, APP_VERSION) < 0 ? changelogEntriesAfter(data.last_seen_version) : null

    set({ loaded: true, whatsNewEntries })
  },

  dismissWhatsNew: async (userId) => {
    set({ whatsNewEntries: null })

    const { error } = await supabase.from('players').update({ last_seen_version: APP_VERSION }).eq('id', userId)

    if (error) {
      console.error('Failed to record last seen version', error)
    }
  },

  setBankBalances: (patch) => set(patch),
  setAscensionPoints: (value) => set({ ascensionPoints: value }),
  addAscensionPoints: (amount) => set((state) => ({ ascensionPoints: state.ascensionPoints + amount })),
  setWarehousePoints: (value) => set({ warehousePoints: value }),
  setGearCompositionPoints: (value) => set({ gearCompositionPoints: value }),
  setMeteorBankCount: (value) => set({ meteorBankCount: value }),
  setDragonballBankCount: (value) => set({ dragonballBankCount: value }),
  setStonesBanked: (value) => set({ stonesBanked: value }),
}))
