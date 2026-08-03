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

// Mirrors the item_instances table. enchant is still unused/inert — sockets
// is now real (2026-08-02, see unlock_weapon_socket/quality_upgrade/
// level_upgrade in supabase/migrations/20260802010000_add_gear_sockets.sql
// and CLAUDE.md's Sockets section): an unlocked-but-empty socket is a plain
// jsonb `null` array element (one socket = [null], two = [null, null]) —
// inserting a gem would later replace that null, but gems aren't
// implemented as items yet so every socket just shows Empty for now.
// quality_tier/level/composition_level/composition_points/sockets are only
// ever changed server-side via the quality_upgrade/level_upgrade/
// composition_feed/unlock_weapon_socket Postgres functions (see
// useForgeStore) — never write them via a normal update(). owner_id
// references characters.id (a specific character), not the account.
export interface ItemInstance {
  id: string
  template_id: string
  owner_id: string
  quality_tier: string
  level: number
  composition_level: number
  composition_points: number
  sockets: (null | Record<string, unknown>)[]
  enchant: unknown | null
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
const NON_DROPPABLE_FAMILIES = ['sword', 'quiver', 'lucky-bow']

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
// Exported so useWarehouseStore can run the identical "would this overflow the
// cap" check before a withdraw (which adds to Inventory), reusing this rather
// than reimplementing it.
export function occupiedSlotCount(items: ItemInstance[]): number {
  const isEquipped = useEquipmentStore.getState().isEquipped
  // Banked gear (location === 'bank') frees its Inventory slot exactly like
  // an equipped item does — see the Bank Storage note on ItemInstance above.
  const gearCount = items.filter((item) => !isEquipped(item.id) && item.location !== 'bank').length
  const totalStoneCount = Object.values(useCompositionStore.getState().stones).reduce((sum, count) => sum + count, 0)
  // A potion stack occupies a slot exactly like a stone tier does — see
  // usePotionStore/potionTypes.ts.
  const potionStackCount = usePotionStore.getState().stacks.filter((stack) => stack.count > 0).length
  // Meteors/DragonBalls are individual, non-stacking Inventory items now
  // (confirmed with the user, 2026-07-31) — same "one tile per unit" term
  // shape as the stone total above. Scrolls (stage 2, same day) are their
  // own non-stacking item too — one Scroll tile per owned Scroll.
  const currency = useCurrencyStore.getState()
  const currencyCount = currency.meteors + currency.dragonballs + currency.meteorScrolls + currency.dragonballScrolls
  return gearCount + totalStoneCount + potionStackCount + currencyCount
}

interface InventoryState {
  items: ItemInstance[]
  loaded: boolean
  // Set when a drop occurs while the inventory is already full during active play —
  // holds the template that would have been granted, awaiting the player's choice of
  // what to discard (see resolvePendingDrop). Null means no decision pending.
  pendingFullDrop: { template: ItemTemplate } | null
  loadInventory: (characterId: string) => Promise<void>
  // Decides only whether an item drops and which template — no DB write, no
  // inventory-full check. This is now purely a PREDICTIVE/cosmetic roll for the
  // combat log's flavor text (see useCombatStore.runTick) — the real, granted
  // drop is resolved server-side (see supabase/functions/resolve-combat), which
  // mirrors this same level-appropriate selection so the prediction is a
  // reasonable (if independently rolled) preview of what the next resolve will
  // actually confirm.
  rollItemDrop: (monsterLevel: number) => { template: ItemTemplate } | null
  // Performs the actual DB insert once a ground item pickup is collected. Returns
  // the granted item + its template on success, or null (no active character, an
  // error, or the inventory is full) — lets the caller (the combat scene) know
  // whether to remove the ground pickup's visual. `interactive` distinguishes
  // actively-played kills (the only path that exists today) from the not-yet-built
  // AFK/offline simulation (see CLAUDE.md's Persistence section) — a full inventory
  // silently wastes the drop when not interactive, or surfaces pendingFullDrop for
  // the player to resolve when it is.
  grantItemDrop: (template: ItemTemplate, interactive?: boolean) => Promise<{ item: ItemInstance; template: ItemTemplate } | null>
  // Reflects a successful quality_upgrade/level_upgrade/composition_feed RPC result
  // in the local cache — the functions already wrote the real values server-side,
  // this just keeps the client's copy in sync without a full refetch.
  patchItem: (
    itemId: string,
    patch: Partial<
      Pick<ItemInstance, 'quality_tier' | 'level' | 'composition_level' | 'composition_points' | 'template_id' | 'sockets'>
    >,
  ) => void
  // Resolves a pendingFullDrop: pass an existing gear item or potion stack to
  // discard (freeing its slot) and grant the new drop in its place, or null to
  // discard the new drop instead and keep the inventory as-is.
  resolvePendingDrop: (discard: { kind: 'item' | 'potion'; id: string } | null) => Promise<void>
  // Drops the given items from the local cache without touching the DB — used
  // after composition_feed destroys fuel items server-side, so the client doesn't
  // need a full refetch just to stop showing them.
  removeItems: (itemIds: string[]) => void
  // Appends an item the server already created (e.g. withdraw_item's fresh
  // Normal/level-1 instance — see useWarehouseStore) without a DB write of its own.
  addItem: (item: ItemInstance) => void
  // Flips an item's location locally after a successful
  // deposit_item_to_storage/withdraw_item_from_storage call (see
  // useWarehouseStore) — the RPC already wrote the real value server-side,
  // this just keeps the client's copy in sync without a full refetch, same
  // spirit as patchItem above.
  setItemLocation: (itemId: string, location: 'inventory' | 'bank') => void
  // Sells a gear item for gold from the Shop tab (see sell_item — item_instances
  // has no client-side delete grant, so this has to go through a SECURITY
  // DEFINER function even though gold itself is otherwise client-authoritative).
  sellItem: (itemId: string) => Promise<{ ok: boolean; error?: string; goldGained?: number; apGained?: number }>
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

  rollItemDrop: (monsterLevel) => {
    const templates = useItemTemplatesStore.getState().templates

    if (templates.length === 0 || Math.random() >= DROP_CHANCE) {
      return null
    }

    const template = pickLevelAppropriateTemplate(templates, monsterLevel, useCharacterStore.getState().selectedClassId)
    return template ? { template } : null
  },

  grantItemDrop: async (template, interactive = true) => {
    const characterId = useActiveCharacterStore.getState().characterId

    if (!characterId) {
      return null
    }

    if (occupiedSlotCount(get().items) >= INVENTORY_SLOT_CAP) {
      if (!interactive) {
        return null
      }

      set({ pendingFullDrop: { template } })
      return null
    }

    // level starts at the template's own required_level (not the schema
    // default of 1) so a freshly-granted item's displayed level honestly
    // reflects which tier it actually is — matching what a successful Level
    // Upgrade already does when it advances an item to a new template.
    const { data, error } = await supabase
      .from('item_instances')
      .insert({ template_id: template.id, owner_id: characterId, level: template.required_level })
      .select('*')
      .single()

    if (error) {
      console.error('Failed to grant item drop', error)
      return null
    }

    const item = data as ItemInstance
    set((state) => ({ items: [...state.items, item] }))
    return { item, template }
  },

  patchItem: (itemId, patch) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }))
  },

  resolvePendingDrop: async (discard) => {
    const pending = get().pendingFullDrop
    if (!pending) {
      return
    }

    if (discard === null) {
      set({ pendingFullDrop: null })
      return
    }

    const characterId = useActiveCharacterStore.getState().characterId
    if (!characterId) {
      set({ pendingFullDrop: null })
      return
    }

    if (discard.kind === 'potion') {
      await usePotionStore.getState().deleteStack(discard.id)
    } else {
      const { error: deleteError } = await supabase.from('item_instances').delete().eq('id', discard.id)
      if (deleteError) {
        console.error('Failed to discard item', deleteError)
        set({ pendingFullDrop: null })
        return
      }
    }

    const { data, error: insertError } = await supabase
      .from('item_instances')
      .insert({ template_id: pending.template.id, owner_id: characterId })
      .select('*')
      .single()

    if (insertError) {
      console.error('Failed to grant item drop', insertError)
      set((state) => ({
        items: discard.kind === 'item' ? state.items.filter((item) => item.id !== discard.id) : state.items,
        pendingFullDrop: null,
      }))
      return
    }

    const newItem = data as ItemInstance
    set((state) => ({
      items: [...(discard.kind === 'item' ? state.items.filter((item) => item.id !== discard.id) : state.items), newItem],
      pendingFullDrop: null,
    }))
  },

  removeItems: (itemIds) => {
    if (itemIds.length === 0) {
      return
    }

    set((state) => ({ items: state.items.filter((item) => !itemIds.includes(item.id)) }))
  },

  // Idempotent by id — matters for claim_mail's "returned listing" case
  // (useMailStore.claim): a reclaimed item's owner_id never actually left
  // the seller, so it's already present in items from the initial load, just
  // hidden by the isListed/hasUnclaimedMail filter. A purchase claim, by
  // contrast, genuinely adds an item the buyer never had locally before —
  // both paths call this same action, so it has to handle either case.
  addItem: (item) => {
    set((state) => (state.items.some((existing) => existing.id === item.id) ? state : { items: [...state.items, item] }))
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
      ap_gained?: number
      ascension_points?: number
    }

    if (result.ok && typeof result.gold_gained === 'number') {
      get().removeItems([itemId])
      // gold-only — addRewards(gold, 0) adds gold without touching EXP/level.
      useProgressionStore.getState().addRewards(result.gold_gained, 0)
      if (typeof result.ap_gained === 'number' && result.ap_gained > 0) {
        usePlayerRecordStore.getState().addAscensionPoints(result.ap_gained)
      }
    }

    return { ok: result.ok, error: result.error, goldGained: result.gold_gained, apGained: result.ap_gained }
  },
}))
