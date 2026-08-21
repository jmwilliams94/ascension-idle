import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'
import { useCompositionStore } from './useCompositionStore'
import { usePotionStore } from './usePotionStore'
import { useEquipmentStore } from './useEquipmentStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useItemTemplatesStore, type ItemTemplate } from './useItemTemplatesStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useGemStore } from './useGemStore'
import { useMarketplaceStore } from '../marketplace/useMarketplaceStore'
import { useMailStore } from '../marketplace/useMailStore'
import type { GemCounts, GemTier, GemTypeId } from './gemTypes'

// Mirrors the item_instances table. sockets is real (2026-08-02, see
// unlock_weapon_socket/quality_upgrade/level_upgrade in supabase/migrations/
// 20260802010000_add_gear_sockets.sql and CLAUDE.md's Sockets section): an
// unlocked-but-empty socket is a plain jsonb `null` array element (one socket
// = [null], two = [null, null]). A filled socket (2026-08-10, socket_gem's
// SQL) is a plain string in gemStorageKey format ("<gemId>_<tier>", e.g.
// "drake_tempered") — never removed, only ever overwritten with a different
// gem string. enchant (2026-08-13, Enchantress — see enchant_item_hp's SQL)
// is `{ hp?: number, blessPct?: number } | null` — `hp` is a flat HP bonus
// rolled from a consumed gem, only ever overwritten with a *higher* value;
// `blessPct` (see bless_item's SQL) is a deterministic Damage Reduction %
// that only ever advances forward along BLESS_PCT_STEPS. Neither key is ever
// removed once set.
// quality_tier/level/composition_level/composition_points/sockets/enchant are
// only ever changed server-side via the quality_upgrade/level_upgrade/
// composition_feed/unlock_weapon_socket/enchant_item_hp Postgres functions
// (see useForgeStore) — never write them via a normal update(). owner_id
// references characters.id (a specific character), not the account.
export interface ItemInstance {
  id: string
  template_id: string
  owner_id: string
  quality_tier: string
  level: number
  composition_level: number
  composition_points: number
  sockets: (null | string)[]
  enchant: { hp?: number; blessPct?: number } | null
  // Gear Durability (2026-08-14) — numeric, not integer, so fractional
  // per-window decay (see resolve-combat's own comment) accumulates exactly.
  // Only ever decremented server-side (resolve_combat_apply_rewards' own
  // p_durability_updates param) or reset to max (repair_all_items) — never
  // write it via a normal update(). N/A for Quiver (always 0, never read).
  durability: number
  created_at: string
  // Bank Storage (confirmed with the user, 2026-08-03, replaces the earlier
  // fungible warehouse_items token model for gear) — a genuinely additive
  // flag, not a new table: depositing/withdrawing an item into/out of Bank
  // Storage just flips this, the row (quality/level/composition/sockets)
  // never changes. 'bank' items are hidden from every Inventory-grid
  // embedding (see occupiedSlotCount below and InventoryPanel's
  // visibleItems), same as an equipped item is.
  location: 'inventory' | 'bank'
}

// Mirrors supabase/functions/resolve-combat's own DROP_CHANCE (confirmed
// with the user, 2026-08-01 — supersedes the earlier flat 10% placeholder).
// This copy is predictive-only (drives the combat log's "You found: X" line
// — see useCombatStore.ts — no real grant happens here), so it doesn't need
// the server's quality-tier roll, just the rate, to keep the log honest
// about how often something was actually found.
const DROP_CHANCE = 1 / 150

// Level-appropriate drop selection (confirmed with the user, 2026-07-30) —
// supersedes the earlier "always the first template" placeholder. Picks a
// random gear family available to the character's class (excluding the
// standalone 'sword' family — the legacy Wooden Sword freebie isn't meant to
// drop from monsters — and 'quiver', a starter/shop-only item for the same
// reason), then the template in that family whose required_level is closest
// to the monster's own level. Mirrored server-side in
// supabase/functions/resolve-combat (the actual grant), since Deno can't
// import this file directly — must stay in sync, same pattern as
// combatResolver.ts's other server/client mirrors.
export const NON_DROPPABLE_FAMILIES = ['sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag', 'promotion-gear', 'promotion-material', 'pickaxe', 'ore']

export function pickLevelAppropriateTemplate(templates: ItemTemplate[], monsterLevel: number, classId: string): ItemTemplate | null {
  const candidates = templates.filter(
    (template) =>
      !NON_DROPPABLE_FAMILIES.includes(template.item_family ?? '') &&
      (template.required_class === null || template.required_class === classId),
  )

  if (candidates.length === 0) {
    return null
  }

  const families = [...new Set(candidates.map((template) => template.item_family))]
  const family = families[Math.floor(Math.random() * families.length)]
  const inFamily = candidates.filter((template) => template.item_family === family)

  return inFamily.reduce((closest, template) =>
    Math.abs(template.required_level - monsterLevel) < Math.abs(closest.required_level - monsterLevel) ? template : closest,
  )
}

// Fixed for now — the real scaling-by-level model (30 up to 40 slots, see CLAUDE.md's
// Inventory section) isn't built yet, so every character is treated as already at the
// max cap.
export const INVENTORY_SLOT_CAP = 40

// Composition stones don't stack at all — confirmed — so every individual stone
// takes up its own slot (the full owned count across every tier, not just a
// count of which tiers are non-empty). All count against the same 40-slot cap.
// Stones must be counted here, not just visually shown in InventoryPanel —
// otherwise the grid's "always exactly 40 rendered cells" invariant breaks the
// moment a player owns any stones (see InventoryPanel, which also defensively
// clamps how many stone tiles it renders in case a manually-set test value
// ever exceeds the remaining budget).
// The equipped item (if any) doesn't count either — equipping now frees its
// Inventory slot, since it's shown only in the Equipment tab's paper doll once
// worn (confirmed, 2026-07-30 — supersedes the earlier behavior where an
// equipped item's tile stayed visible/counted in Inventory too).
// Exported so useBankStore can run the identical "would this overflow the
// cap" check before a withdraw (which adds to Inventory), reusing this rather
// than reimplementing it.
export function occupiedSlotCount(items: ItemInstance[]): number {
  const isEquipped = useEquipmentStore.getState().isEquipped
  // Actively-listed (Marketplace escrow) and unclaimed-Mail items are real
  // item_instances rows still owned by this character, but InventoryPanel's
  // own visibleItems filter already hides both from the grid (see the Bank/
  // Marketplace/Mail sections of CLAUDE.md) — this must exclude the exact
  // same set, or a stray listing/unclaimed-mail item silently eats a "phantom"
  // slot that never appears in the displayed count. Fixed 2026-08-13 after a
  // real report: player saw "5/40" but every claim/grant failed with
  // "Inventory full" — root cause was this function counting a hidden
  // listed/mailed item the header count didn't.
  const isListed = useMarketplaceStore.getState().isListed
  const hasUnclaimedMail = useMailStore.getState().hasUnclaimedMail
  // Banked gear (location === 'bank') frees its Inventory slot exactly like
  // an equipped item does — see the Bank Storage note on ItemInstance above.
  const gearCount = items.filter(
    (item) => !isEquipped(item.id) && item.location !== 'bank' && !isListed(item.id) && !hasUnclaimedMail(item.id),
  ).length
  const totalStoneCount = Object.values(useCompositionStore.getState().stones).reduce((sum, count) => sum + count, 0)
  // Gems are real, physical, non-stacking Inventory tiles now (2026-08-09) —
  // one slot per owned unit, same as Comets/Stones. Must stay in sync with
  // draw_lucky_ticket/transfer_gem's own occupied-slot formula.
  const totalGemCount = Object.values(useGemStore.getState().gems).reduce<number>((sum, count) => sum + (count ?? 0), 0)
  // A potion stack occupies a slot exactly like a stone tier does — see
  // usePotionStore/potionTypes.ts.
  const potionStackCount = usePotionStore.getState().stacks.filter((stack) => stack.count > 0).length
  // Comets/Fallen Stars are individual, non-stacking Inventory items now
  // (confirmed with the user, 2026-07-31) — same "one tile per unit" term
  // shape as the stone total above. Scrolls (stage 2, same day) are their
  // own non-stacking item too — one Scroll tile per owned Scroll.
  const currency = useCurrencyStore.getState()
  const currencyCount =
    currency.comets + currency.fallenStars + currency.cometScrolls + currency.fallenStarScrolls + currency.cometBoxes
  return gearCount + totalStoneCount + totalGemCount + potionStackCount + currencyCount
}

interface InventoryState {
  items: ItemInstance[]
  loaded: boolean
  // Set when a Shop purchase can't fit (buyShopItem returned 'inventory_full') —
  // holds the template that would have been bought, awaiting the player's choice
  // of what to discard, or null to cancel the purchase. Null means no decision
  // pending. Gold is never deducted until the purchase actually completes, so a
  // cancel here is a genuine no-op, not a refund.
  pendingFullDrop: { template: ItemTemplate } | null
  loadInventory: (characterId: string) => Promise<void>
  // Decides only whether an item drops and which template — no DB write, no
  // inventory-full check. This is now purely a PREDICTIVE/cosmetic roll for the
  // combat log's flavor text (see useCombatStore.runTick) — the real, granted
  // drop is resolved server-side (see supabase/functions/resolve-combat), which
  // mirrors this same level-appropriate selection so the prediction is a
  // reasonable (if independently rolled) preview of what the next resolve will
  // actually confirm.
  rollItemDrop: (monsterLevel: number, dropMultiplier?: number) => { template: ItemTemplate } | null
  // Shop purchase (Weapons/Armor/Jeweller tabs) — the only caller of the
  // shop_buy_item RPC. item_instances has no client-side INSERT grant, so cost/
  // level/class validation and the actual row creation happen server-side in one
  // transaction (see migration 20260821000000_lock_down_direct_table_writes.sql).
  // Pass `discard` to resolve a prior 'inventory_full' response (an existing gear
  // item or potion stack to free up, or omit to just cancel the purchase).
  buyShopItem: (
    template: ItemTemplate,
    discard?: { kind: 'item' | 'potion'; id: string },
  ) => Promise<{ ok: boolean; error?: string; item?: ItemInstance }>
  // Cancels a pending 'inventory_full' purchase decision without spending
  // anything — gold is only ever deducted server-side once the purchase (or
  // its discard-and-retry) actually succeeds, so there's nothing to refund.
  cancelPendingDrop: () => void
  // Reflects a successful quality_upgrade/level_upgrade/composition_feed RPC result
  // in the local cache — the functions already wrote the real values server-side,
  // this just keeps the client's copy in sync without a full refetch.
  patchItem: (
    itemId: string,
    patch: Partial<
      Pick<
        ItemInstance,
        'quality_tier' | 'level' | 'composition_level' | 'composition_points' | 'template_id' | 'sockets' | 'enchant' | 'durability'
      >
    >,
  ) => void
  // Drops the given items from the local cache without touching the DB — used
  // after composition_feed destroys fuel items server-side, so the client doesn't
  // need a full refetch just to stop showing them.
  removeItems: (itemIds: string[]) => void
  // Appends an item the server already created (e.g. withdraw_item's fresh
  // Normal/level-1 instance — see useBankStore) without a DB write of its own.
  addItem: (item: ItemInstance) => void
  // Flips an item's location locally after a successful
  // deposit_item_to_storage/withdraw_item_from_storage call (see
  // useBankStore) — the RPC already wrote the real value server-side,
  // this just keeps the client's copy in sync without a full refetch, same
  // spirit as patchItem above.
  setItemLocation: (itemId: string, location: 'inventory' | 'bank') => void
  // Sells a gear item for gold from the Shop tab (see sell_item — item_instances
  // has no client-side delete grant, so this has to go through a SECURITY
  // DEFINER function even though gold itself is otherwise client-authoritative).
  // Gold-only — Ascension Points come from Salvage alone (see salvageItem
  // below), removed from Sell 2026-08-14 at the user's request.
  sellItem: (itemId: string) => Promise<{ ok: boolean; error?: string; goldGained?: number }>
  // Forge's Salvage tab (see salvage_item) — destroys a gear item for
  // Ascension Points only, no gold. A separate action from sellItem since
  // the two have genuinely different payouts, not just different UI.
  salvageItem: (itemId: string) => Promise<{ ok: boolean; error?: string; apGained?: number }>
  // Money Bag / Gem Bag "Open" action (see open_reward_item) — consumes the
  // item, grants its wrapped reward (gold for a Money Bag, 1 random Normal
  // gem for a Gem Bag). Returns what was granted so the caller can drive
  // useMoneyBagRevealStore's reveal card.
  openRewardItem: (itemId: string) => Promise<{
    ok: boolean
    error?: string
    granted?: { kind: 'gold'; amount: number } | { kind: 'gem'; gem_id: GemTypeId; tier: GemTier }
  }>
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  loaded: false,
  pendingFullDrop: null,

  loadInventory: async (characterId) => {
    const { data, error } = await supabase.from('item_instances').select('*').eq('owner_id', characterId)

    if (error) {
      console.error('Failed to load inventory', error)
      return
    }

    set({ items: (data ?? []) as ItemInstance[], loaded: true })
  },

  rollItemDrop: (monsterLevel, dropMultiplier = 1) => {
    const templates = useItemTemplatesStore.getState().templates

    if (templates.length === 0 || Math.random() >= DROP_CHANCE * dropMultiplier) {
      return null
    }

    const template = pickLevelAppropriateTemplate(templates, monsterLevel, useCharacterStore.getState().selectedClassId)
    return template ? { template } : null
  },

  buyShopItem: async (template, discard) => {
    const characterId = useActiveCharacterStore.getState().characterId

    if (!characterId) {
      return { ok: false }
    }

    // Routed through the shop_buy_item RPC (see migration
    // 20260821000000_lock_down_direct_table_writes.sql) — item_instances has
    // no direct client INSERT grant anymore, so cost/level/class validation
    // and the actual row creation all happen server-side in one transaction.
    // A prior 'inventory_full' response leaves `pendingFullDrop` set; the
    // caller resolves it by calling this again with a `discard` target
    // (or `null` to just cancel), same round-trip shape as before.
    const { data, error } = await supabase.rpc('shop_buy_item', {
      p_character_id: characterId,
      p_template_id: template.id,
      p_discard_item_id: discard?.kind === 'item' ? discard.id : null,
      p_discard_potion_stack_id: discard?.kind === 'potion' ? discard.id : null,
    })

    if (error) {
      console.error('Shop item purchase failed', error)
      set({ pendingFullDrop: null })
      return { ok: false }
    }

    const result = data as { ok: boolean; error?: string; item?: ItemInstance; gold?: number }

    if (!result.ok) {
      if (result.error === 'inventory_full') {
        set({ pendingFullDrop: { template } })
      } else {
        set({ pendingFullDrop: null })
      }
      return { ok: false, error: result.error }
    }

    if (typeof result.gold === 'number') {
      useProgressionStore.getState().setGold(result.gold)
    }

    set((state) => ({
      items: [
        ...(discard?.kind === 'item' ? state.items.filter((item) => item.id !== discard.id) : state.items),
        ...(result.item ? [result.item] : []),
      ],
      pendingFullDrop: null,
    }))

    if (discard?.kind === 'potion') {
      await usePotionStore.getState().loadStacks(characterId)
    }

    return { ok: true, item: result.item }
  },

  patchItem: (itemId, patch) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }))
  },

  cancelPendingDrop: () => set({ pendingFullDrop: null }),

  removeItems: (itemIds) => {
    if (itemIds.length === 0) {
      return
    }

    set((state) => ({ items: state.items.filter((item) => !itemIds.includes(item.id)) }))
  },

  // Upsert by id — matters for two distinct already-present cases, not just
  // duplicate prevention: claim_mail's "returned listing" case
  // (useMailStore.claim), where a reclaimed item's owner_id never actually
  // left the seller, so it's already present in items from the initial load,
  // just hidden by the isListed/hasUnclaimedMail filter (no field actually
  // changes there, a plain skip used to be enough) — and Bank Storage's own
  // withdraw (useBankStore.withdrawItemFromStorage/withdrawGearComposition),
  // where the item genuinely IS already present (loadInventory loads every
  // item this character owns regardless of location, including banked ones)
  // but its `location`/`owner_id` fields are stale until the withdraw call's
  // own patched object replaces them — a plain skip left the item silently
  // stuck hidden behind the bank-location filter forever, looking exactly
  // like it had been deleted. Every caller already passes a fully-correct
  // item object (the server's own response, or a manually patched copy), so
  // replacing on a match is always safe, not just appending when absent.
  addItem: (item) => {
    set((state) => ({
      items: state.items.some((existing) => existing.id === item.id)
        ? state.items.map((existing) => (existing.id === item.id ? item : existing))
        : [...state.items, item],
    }))
  },

  setItemLocation: (itemId, location) => {
    set((state) => ({ items: state.items.map((item) => (item.id === itemId ? { ...item, location } : item)) }))
  },

  sellItem: async (itemId) => {
    const { data, error } = await supabase.rpc('sell_item', { item_id: itemId })

    if (error) {
      console.error('Sell item call failed', error)
      return { ok: false }
    }

    const result = data as {
      ok: boolean
      error?: string
      gold_gained?: number
      gold?: number
    }

    if (result.ok && typeof result.gold_gained === 'number') {
      get().removeItems([itemId])
      // gold-only — addRewards(gold, 0) adds gold without touching EXP/level.
      useProgressionStore.getState().addRewards(result.gold_gained, 0)
    }

    return { ok: result.ok, error: result.error, goldGained: result.gold_gained }
  },

  salvageItem: async (itemId) => {
    const { data, error } = await supabase.rpc('salvage_item', { item_id: itemId })

    if (error) {
      console.error('Salvage item call failed', error)
      return { ok: false }
    }

    const result = data as {
      ok: boolean
      error?: string
      ap_gained?: number
      ascension_points?: number
    }

    if (result.ok && typeof result.ap_gained === 'number') {
      get().removeItems([itemId])
      usePlayerRecordStore.getState().addAscensionPoints(result.ap_gained)
    }

    return { ok: result.ok, error: result.error, apGained: result.ap_gained }
  },

  openRewardItem: async (itemId) => {
    const { data, error } = await supabase.rpc('open_reward_item', { item_id: itemId })

    if (error) {
      console.error('Open reward item call failed', error)
      return { ok: false }
    }

    const result = data as {
      ok: boolean
      error?: string
      granted?: { kind: 'gold'; amount: number } | { kind: 'gem'; gem_id: GemTypeId; tier: GemTier }
      gold?: number
      gems?: GemCounts
    }

    if (result.ok && result.granted) {
      get().removeItems([itemId])
      if (result.granted.kind === 'gold') {
        // gold-only — addRewards(gold, 0) adds gold without touching EXP/level.
        useProgressionStore.getState().addRewards(result.granted.amount, 0)
      } else if (result.gems) {
        useGemStore.getState().setGems(result.gems)
      }
    }

    return { ok: result.ok, error: result.error, granted: result.granted }
  },
}))
