import { create } from 'zustand'
import { changelogEntriesForWhatsNew, type ChangelogEntry } from './changelog'
import { compareVersions } from './semver'
import { supabase } from './supabaseClient'
import { APP_VERSION } from '../version'
import { DEFAULT_GEAR_COMPOSITION_POINTS, type GearCompositionPoints } from '../game/items/forgeCosts'
import type { CompositionStones } from '../game/items/useCompositionStore'
import type { GemCounts } from '../game/items/gemTypes'
import { useLuckyStore } from '../game/lucky/useLuckyStore'

const DEFAULT_STONES_BANKED: CompositionStones = { '1': 0, '2': 0, '3': 0, '4': 0 }
const DEFAULT_GEMS_BANKED: GemCounts = {}

// Account-level only — class/level/gold/exp/zone/equipped/comets/fallen stars all
// moved to the characters table (see useCharacterRecordStore) as part of the
// character-slots restructure. This store now only concerns itself with things that
// apply to the whole account, not any one character.
interface PlayerRow {
  last_seen_version: string | null
  bank_gold: number
  bank_comets: number
  bank_fallen_stars: number
  unlocked_classes: string[]
  // Lucky Lad's free-ticket cooldown (2026-10-22, moved from characters —
  // was per-character, so deleting+recreating a character reset it into an
  // unlimited free-ticket farm; see CLAUDE.md's Lucky section). Same trust
  // model as ascension_points: server-authoritative, only ever written by
  // draw_lucky_ticket.
  lucky_free_ticket_claimed_at: string | null
  ascension_points: number
  bank_points: number
  gear_composition_points: GearCompositionPoints
  comet_bank_count: number
  fallen_star_bank_count: number
  // VIP Token/Experience Orb/Experience Potion physical Storage counts
  // (2026-12-07, see 20261207020000_vip_orb_potion_warehouse_storage.sql) —
  // same shape as comet_bank_count/fallen_star_bank_count above, rendered as
  // account-wide tiles in BankGrid.tsx's Storage grid.
  vip_token_bank_count: number
  experience_orb_bank_count: number
  experience_potion_bank_count: number
  composition_stones_banked: CompositionStones
  // Gems' own account-wide bank balance (2026-08-09) — see transfer_gem.
  // Same key format as characters.gems ("<gemId>_<tier>").
  gems_banked: GemCounts
  // Achievements rework (2026-08-06) — permanent combat buffs, cumulative
  // across every monster's own account-tier Achievement claims (see
  // claim_account_achievement_reward). Both made per-zone (2026-08-07,
  // confirmed with the user — attack bonus used to be a flat account-wide
  // scalar applied to every fight regardless of zone, which was never the
  // intent). Keyed by zone id (see ZONE_ORDER), missing key means 0. Read by
  // resolve-combat to boost real outgoing attack/drop-quality chance
  // server-side, scoped to whichever zone is currently being fought; see
  // useCombatStore.ts for the client-side predictive mirror.
  account_zone_attack_bonus_pct: Record<string, number>
  // Only ever boosts quality-tier odds on an already-happened drop, never
  // base drop frequency — see resolve-combat/index.ts's own
  // accountDropMultiplier usage.
  account_zone_drop_bonus_pct: Record<string, number>
}

interface PlayerRecordState {
  // False until loadPlayerRecord's initial fetch has finished.
  loaded: boolean
  // Entries to show in the "What's New" modal. Null means nothing to show (either
  // not loaded yet, already up to date, or already dismissed this session).
  whatsNewEntries: ChangelogEntry[] | null
  // Shared account-wide bank (the Bank tab's currency section) — deposited/
  // withdrawn via transfer_currency (see useBankStore), never written directly
  // by the client, same trust model as comets/fallen stars on the character row.
  bankGold: number
  bankComets: number
  bankFallenStars: number
  // Account-wide class-unlock milestones (e.g. a Hunter reaching max level), not
  // per-character. 'hunter'/'wuxia' unlocked by default; twin-soul/juggernaut
  // still have no unlock mechanic (their gear catalogs are prep-only).
  unlockedClasses: string[]
  // Ascension Points (2026-08-03) — a premium currency, account-wide by design
  // (confirmed with the user, corrects an earlier per-character version):
  // earned only via sell_item/sell_loot_holding's ap_gained, spent only via
  // the Marketplace RPCs. Unlike bank_gold/bank_comets/bank_fallen_stars
  // there's no separate per-character wallet for this at all — one shared
  // balance, same shape as unlockedClasses above rather than a wallet/bank
  // pair. Server-authoritative — never written except to reflect an RPC's
  // response.
  ascensionPoints: number
  // Bank tab rework (2026-08-03, confirmed with the user) — Storage becomes
  // fully account-wide, not just the points pools: bank_points/
  // gear_composition_points (the two liquidation pools) and comet_bank_count/
  // fallen_star_bank_count/composition_stones_banked (the physical Bank
  // Storage counts) all moved from characters to players in the same
  // migration that removed the dead legacy warehouse_items token system. See
  // useBankStore.ts for the RPC wrappers that mutate these.
  bankPoints: number
  gearCompositionPoints: GearCompositionPoints
  cometBankCount: number
  fallenStarBankCount: number
  vipTokenBankCount: number
  experienceOrbBankCount: number
  experiencePotionBankCount: number
  stonesBanked: CompositionStones
  gemsBanked: GemCounts
  // Achievements rework (2026-08-06) — see PlayerRow's own comment above.
  accountZoneAttackBonusPct: Record<string, number>
  accountZoneDropBonusPct: Record<string, number>
  loadPlayerRecord: (userId: string) => Promise<void>
  dismissWhatsNew: (userId: string) => Promise<void>
  // Reflects a successful transfer_currency RPC result in the local cache —
  // mirrors useCurrencyStore's setComets/setFallenStars pattern.
  setBankBalances: (patch: Partial<{ bankGold: number; bankComets: number; bankFallenStars: number }>) => void
  setAscensionPoints: (value: number) => void
  // Incremental, not absolute — used specifically for sell_item/
  // sell_loot_holding's ap_gained, since Shop's bulk-sell fires many sell
  // calls in parallel (Promise.all); an absolute set from each response could
  // let an out-of-order-arriving response clobber a later one.
  addAscensionPoints: (amount: number) => void
  setBankPoints: (value: number) => void
  setGearCompositionPoints: (value: GearCompositionPoints) => void
  setCometBankCount: (value: number) => void
  setFallenStarBankCount: (value: number) => void
  setVipTokenBankCount: (value: number) => void
  setExperienceOrbBankCount: (value: number) => void
  setExperiencePotionBankCount: (value: number) => void
  setStonesBanked: (value: CompositionStones) => void
  setGemsBanked: (value: GemCounts) => void
  setAccountZoneAttackBonusPct: (value: Record<string, number>) => void
  setAccountZoneDropBonusPct: (value: Record<string, number>) => void
}

export const usePlayerRecordStore = create<PlayerRecordState>((set) => ({
  loaded: false,
  whatsNewEntries: null,
  bankGold: 0,
  bankComets: 0,
  bankFallenStars: 0,
  unlockedClasses: ['hunter', 'wuxia'],
  ascensionPoints: 0,
  bankPoints: 0,
  gearCompositionPoints: DEFAULT_GEAR_COMPOSITION_POINTS,
  cometBankCount: 0,
  fallenStarBankCount: 0,
  vipTokenBankCount: 0,
  experienceOrbBankCount: 0,
  experiencePotionBankCount: 0,
  stonesBanked: DEFAULT_STONES_BANKED,
  gemsBanked: DEFAULT_GEMS_BANKED,
  accountZoneAttackBonusPct: {},
  accountZoneDropBonusPct: {},

  loadPlayerRecord: async (userId) => {
    const { data, error } = await supabase
      .from('players')
      .select(
        'last_seen_version, bank_gold, bank_comets, bank_fallen_stars, unlocked_classes, lucky_free_ticket_claimed_at, ascension_points, bank_points, gear_composition_points, comet_bank_count, fallen_star_bank_count, vip_token_bank_count, experience_orb_bank_count, experience_potion_bank_count, composition_stones_banked, gems_banked, account_zone_attack_bonus_pct, account_zone_drop_bonus_pct',
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

      useLuckyStore.getState().hydrate(null)

      set({
        loaded: true,
        whatsNewEntries: null,
        bankGold: 0,
        bankComets: 0,
        bankFallenStars: 0,
        unlockedClasses: ['hunter', 'wuxia'],
        ascensionPoints: 0,
        bankPoints: 0,
        gearCompositionPoints: DEFAULT_GEAR_COMPOSITION_POINTS,
        cometBankCount: 0,
        fallenStarBankCount: 0,
        vipTokenBankCount: 0,
        experienceOrbBankCount: 0,
        experiencePotionBankCount: 0,
        stonesBanked: DEFAULT_STONES_BANKED,
        gemsBanked: DEFAULT_GEMS_BANKED,
        accountZoneAttackBonusPct: {},
        accountZoneDropBonusPct: {},
      })
      return
    }

    useLuckyStore.getState().hydrate(data.lucky_free_ticket_claimed_at)

    set({
      bankGold: data.bank_gold,
      bankComets: data.bank_comets,
      bankFallenStars: data.bank_fallen_stars,
      unlockedClasses: data.unlocked_classes,
      ascensionPoints: data.ascension_points,
      bankPoints: data.bank_points,
      gearCompositionPoints: data.gear_composition_points,
      cometBankCount: data.comet_bank_count,
      fallenStarBankCount: data.fallen_star_bank_count,
      vipTokenBankCount: data.vip_token_bank_count,
      experienceOrbBankCount: data.experience_orb_bank_count,
      experiencePotionBankCount: data.experience_potion_bank_count,
      stonesBanked: data.composition_stones_banked,
      gemsBanked: data.gems_banked ?? DEFAULT_GEMS_BANKED,
      accountZoneAttackBonusPct: data.account_zone_attack_bonus_pct ?? {},
      accountZoneDropBonusPct: data.account_zone_drop_bonus_pct ?? {},
    })

    if (!data.last_seen_version) {
      // Row predates version tracking (or somehow has none) — record it silently.
      await supabase.from('players').update({ last_seen_version: APP_VERSION }).eq('id', userId)
      set({ loaded: true, whatsNewEntries: null })
      return
    }

    const whatsNewEntries =
      compareVersions(data.last_seen_version, APP_VERSION) < 0
        ? changelogEntriesForWhatsNew(data.last_seen_version)
        : null

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
  setBankPoints: (value) => set({ bankPoints: value }),
  setGearCompositionPoints: (value) => set({ gearCompositionPoints: value }),
  setCometBankCount: (value) => set({ cometBankCount: value }),
  setFallenStarBankCount: (value) => set({ fallenStarBankCount: value }),
  setVipTokenBankCount: (value) => set({ vipTokenBankCount: value }),
  setExperienceOrbBankCount: (value) => set({ experienceOrbBankCount: value }),
  setExperiencePotionBankCount: (value) => set({ experiencePotionBankCount: value }),
  setStonesBanked: (value) => set({ stonesBanked: value }),
  setGemsBanked: (value) => set({ gemsBanked: value }),
  setAccountZoneAttackBonusPct: (value) => set({ accountZoneAttackBonusPct: value }),
  setAccountZoneDropBonusPct: (value) => set({ accountZoneDropBonusPct: value }),
}))
