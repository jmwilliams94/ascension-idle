import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { DraggableInventorySlot } from './dragDrop'
import GearEquipPopover from './GearEquipPopover'
import TooltipActionPopover from './TooltipActionPopover'
import {
  buildGearTooltip,
  formatBaseStats,
  formatItemDisplayName,
  formatItemLevel,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  previewSellPrice,
} from '../game/items/equipmentBonus'
import { EQUIP_SLOTS, useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
import {
  COMPOSITION_STONE_TIERS,
  CONSUMABLE_COLOR,
  DRAGONBALL_COLOR,
  DRAGONBALL_ICON_SRC,
  MATERIAL_COLOR,
  METEOR_ICON_SRC,
  buildDragonballScrollTooltip,
  buildDragonballTooltip,
  buildMeteorScrollTooltip,
  buildMeteorTooltip,
  buildStoneTooltip,
  compositionPointValue,
  dragonballDragId,
  dragonballScrollDragId,
  meteorDragId,
  meteorScrollDragId,
  stoneDragId,
} from '../game/items/forgeCosts'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { useCompositionStore } from '../game/items/useCompositionStore'
import { INVENTORY_SLOT_CAP, useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { useMarketplaceStore } from '../game/marketplace/useMarketplaceStore'
import { useMailStore } from '../game/marketplace/useMailStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { POTION_TYPES } from '../game/items/potionTypes'
import { useWarehouseStore } from '../game/items/useWarehouseStore'

// A single fixed 40-cell grid shared by gear (item_instances), Composition
// stones, Meteors/DragonBalls (+ their Scrolls), and HP/Mana potion stacks —
// a stack/stone/currency unit takes up a slot exactly like a gear item does,
// all counting against the same cap (see occupiedSlotCount in
// useInventoryStore). Always renders all 40 cells, empty ones
// dimmed/unclickable, so Forge's drag-and-drop has a stable, always-present
// set of slots to pick gear/stones up from.
type SelectedSlot =
  | { kind: 'item'; id: string }
  | { kind: 'stone'; dragId: string; tier: number }
  | { kind: 'potion'; id: string }
  | { kind: 'currency'; dragId: string; currencyType: 'meteor' | 'dragonball' }
  | { kind: 'scroll'; dragId: string; currencyType: 'meteor' | 'dragonball' }
  | null

interface InventoryPanelProps {
  // Gear items/stone tiers currently sitting in Forge's Upgrade Slot and/or Fuel
  // zone (if any) — their cells render empty here instead of filled, so nothing is
  // ever shown in two Forge drop targets (or the grid and a drop target) at once.
  // Stone tiers use the synthetic id from stoneDragId, real items use their own id.
  // Only ForgePanel passes this; every other usage is unaffected.
  reservedItemIds?: string[]
  // Present when rendered inside Forge or Warehouse — makes gear and stone
  // tiles draggable (see dragDrop.tsx), calling back with whichever
  // data-drop-zone target (Forge: ForgeUpgradeSlot/ForgeMaterialSlot; Warehouse:
  // WarehouseGrid's own storage grid) the tile was released over, and the
  // dragged id (a real item id, or a synthetic stoneDragId for a stone). Not
  // called if the tile was dropped somewhere with no valid target. Stones
  // don't stack — each tile is exactly one stone, so dragging one tile feeds
  // exactly one; feeding more means dragging in more individual tiles. The
  // grid area itself always carries data-drop-zone="inventory" (below) so a
  // tile dragged the other way — e.g. from WarehouseGrid — can land back here,
  // regardless of whether this instance's own tiles are draggable.
  onTileDrop?: (overTarget: string, id: string) => void
  // Present only when rendered inside the Shop — adds a "Sell" button to the gear
  // detail card. Every other usage omits this, so gear elsewhere has no sell action.
  // The actual sell logic lives entirely in useInventoryStore.sellItem (removes
  // the item, adds gold) — this is just an opt-in display flag, not a callback.
  enableSelling?: boolean
  // Grid width in columns — defaults to 8 (5 rows) for a wide layout; the Combat
  // page's narrower column passes 5 (8 rows) instead. Always 40 cells total either way.
  columns?: number
  // Inventory-grid-only (confirmed with the user, 2026-08-03) — swaps a gear
  // tile's click behavior from "select it, show a detail card below the
  // grid" to "open GearEquipPopover right at the tile," which folds the old
  // card's Equip button plus a new Compare-against-currently-equipped view
  // directly into the same hover-tooltip-styled card, and drops the plain
  // hover/long-press peek for these tiles (press is now the only trigger).
  // Only CombatPage's two InventoryPanel instances pass this — Forge/
  // Warehouse/Shop/Marketplace's own embeddings are unaffected, since their
  // click already means something else there (drag source, sell selection,
  // listing source) that this popover isn't designed around.
  equipPopoverEnabled?: boolean
  // Bank-tab-only (confirmed with the user, 2026-08-03) — mirrors
  // equipPopoverEnabled's own click-opens-actionable-tooltip pattern, but for
  // depositing into Storage instead of equipping. Clicking a gear or stone
  // tile opens a TooltipActionPopover with a single "Deposit" button (gear:
  // deposit_item's existing "as item token" path; stone: deposits one of that
  // tier) rather than the plain hover tooltip/old detail card. Also adds a
  // "Deposit All" button to the header, looping every eligible gear item +
  // every owned stone tier. Only WarehousePanel's Inventory-grid embedding
  // passes this — it coexists with that same instance's onTileDrop (drag
  // still works for depositing too, this is just a click-based alternative).
  // Meteor/DragonBall/Scroll tiles are deliberately untouched — those already
  // have their own dedicated Deposit control in BankedCard's CurrencyRow, and
  // Bundle/Unbundle still needs to work on those tiles here.
  enableBankDeposit?: boolean
}

export default function InventoryPanel({
  reservedItemIds = [],
  onTileDrop,
  enableSelling = false,
  columns = 8,
  equipPopoverEnabled = false,
  enableBankDeposit = false,
}: InventoryPanelProps) {
  const items = useInventoryStore((state) => state.items)
  const sellItem = useInventoryStore((state) => state.sellItem)
  const templates = useItemTemplatesStore((state) => state.templates)
  const setEquippedItem = useEquipmentStore((state) => state.setEquippedItem)
  // Subscribe to equippedIds itself, not the isEquipped function — isEquipped's
  // reference never changes (it's set once at store creation), so selecting it
  // directly never re-renders this component when equipment actually changes,
  // only whenever something else forces a re-render (e.g. selecting a tile).
  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const isEquipped = (itemId: string) => Object.values(equippedIds).includes(itemId)
  const characterLevel = useProgressionStore((state) => state.level)

  const stones = useCompositionStore((state) => state.stones)
  const meteors = useCurrencyStore((state) => state.meteors)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)
  const meteorScrolls = useCurrencyStore((state) => state.meteorScrolls)
  const dragonballScrolls = useCurrencyStore((state) => state.dragonballScrolls)
  const bundleScroll = useCurrencyStore((state) => state.bundleScroll)
  const unbundleScroll = useCurrencyStore((state) => state.unbundleScroll)
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const potionStacks = usePotionStore((state) => state.stacks)
  const handlePotionUse = usePotionStore((state) => state.usePotion)
  const currentPlayerHp = useCombatStore((state) => state.currentPlayerHp)
  const maxPlayerHp = useCombatStore((state) => state.maxPlayerHp)
  // Same "subscribe to the reactive data, not a stable selector-function
  // reference" fix as equippedIds above — myListings/mail entries, not
  // isListed/hasUnclaimedMail themselves.
  const myListings = useMarketplaceStore((state) => state.myListings)
  const isListed = (itemId: string) => myListings.some((listing) => listing.status === 'active' && listing.item_id === itemId)
  const mailEntries = useMailStore((state) => state.entries)
  const hasUnclaimedMail = (itemId: string) => mailEntries.some((entry) => entry.item_id === itemId)
  const depositItem = useWarehouseStore((state) => state.depositItem)
  const depositStone = useWarehouseStore((state) => state.depositStone)

  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot>(null)
  // GearEquipPopover-only (equipPopoverEnabled) — the clicked tile's own
  // bounding rect, captured at click time so the popover can anchor itself
  // there via a portal. Unused/always null when equipPopoverEnabled is off.
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null)
  // enableBankDeposit-only — same anchoring idea as popoverAnchorRect above,
  // kept as its own state since the two modes are mutually exclusive per
  // instance but shouldn't share a variable name that implies they're the
  // same popover.
  const [bankPopoverAnchorRect, setBankPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [bankDepositBusy, setBankDepositBusy] = useState(false)
  const [bankDepositError, setBankDepositError] = useState<string | null>(null)
  const [sellBusy, setSellBusy] = useState(false)
  const [sellError, setSellError] = useState<string | null>(null)
  // Bulk-sell checkbox selection (Shop only, see enableSelling) — independent
  // of selectedSlot, which drives the single-item detail card.
  const [selectedForSale, setSelectedForSale] = useState<Set<string>>(new Set())
  // Bundle/unbundle busy+error feedback (stage 2, 2026-07-31) — separate from
  // sellBusy/sellError since they're independent actions on different tiles.
  const [scrollBusy, setScrollBusy] = useState(false)
  const [scrollError, setScrollError] = useState<string | null>(null)

  const visiblePotionStacks = potionStacks.filter((stack) => stack.count > 0)

  // The equipped item (if any) no longer shows here at all — once worn, it's
  // shown only in the Equipment tab's paper doll (confirmed, 2026-07-30), and
  // frees its Inventory slot (see occupiedSlotCount in useInventoryStore).
  // Un-equipping brings it straight back since this filter just stops matching.
  // Same hide-via-filter treatment (2026-08-02) for an actively-listed
  // Marketplace item and an item sitting in unclaimed Mail — see
  // useMarketplaceStore.isListed/useMailStore.hasUnclaimedMail.
  const visibleItems = items.filter((item) => !isEquipped(item.id) && !isListed(item.id) && !hasUnclaimedMail(item.id))

  // Stones don't stack — each one is its own tile, not combined into one tile with
  // a count badge. Since there's no acquisition-time cap check for stones yet (no
  // drop mechanic exists — see CLAUDE.md), a manually-set test value could in
  // theory own more stones than fit in the remaining grid; this budget (recomputed
  // from how many tiles have accumulated so far, rather than a mutated counter, to
  // stay a pure reduce) clamps how many tiles actually render so the grid never
  // exceeds its fixed 40 cells, rather than owning stones simply not showing up as
  // a hard error.
  const baseStoneBudget = Math.max(0, INVENTORY_SLOT_CAP - visiblePotionStacks.length - visibleItems.length)
  const stoneTiles = COMPOSITION_STONE_TIERS.reduce<{ tier: number; index: number; dragId: string }[]>((acc, tier) => {
    const owned = stones[String(tier)] ?? 0
    const shown = Math.min(owned, Math.max(0, baseStoneBudget - acc.length))

    for (let index = 0; index < shown; index += 1) {
      acc.push({ tier, index, dragId: stoneDragId(tier, index) })
    }

    return acc
  }, [])

  // Meteors/DragonBalls don't stack either (same as Stones — confirmed with the
  // user, 2026-07-31) — one tile per owned unit, sharing the same remaining-
  // budget clamp, allocated after Stones in the same greedy fashion.
  const remainingAfterStones = Math.max(0, baseStoneBudget - stoneTiles.length)
  const meteorShown = Math.min(meteors, remainingAfterStones)
  const meteorTiles = Array.from({ length: meteorShown }, (_, index) => ({ index, dragId: meteorDragId(index) }))
  const remainingAfterMeteors = Math.max(0, remainingAfterStones - meteorTiles.length)
  const dragonballShown = Math.min(dragonballs, remainingAfterMeteors)
  const dragonballTiles = Array.from({ length: dragonballShown }, (_, index) => ({ index, dragId: dragonballDragId(index) }))

  // Scrolls (stage 2, 2026-07-31) are their own non-stacking item too — one
  // tile per owned Scroll, allocated last in the same greedy chain.
  const remainingAfterDragonballs = Math.max(0, remainingAfterMeteors - dragonballTiles.length)
  const meteorScrollShown = Math.min(meteorScrolls, remainingAfterDragonballs)
  const meteorScrollTiles = Array.from({ length: meteorScrollShown }, (_, index) => ({ index, dragId: meteorScrollDragId(index) }))
  const remainingAfterMeteorScrolls = Math.max(0, remainingAfterDragonballs - meteorScrollTiles.length)
  const dragonballScrollShown = Math.min(dragonballScrolls, remainingAfterMeteorScrolls)
  const dragonballScrollTiles = Array.from({ length: dragonballScrollShown }, (_, index) => ({
    index,
    dragId: dragonballScrollDragId(index),
  }))

  const occupiedCount =
    stoneTiles.length +
    meteorTiles.length +
    dragonballTiles.length +
    meteorScrollTiles.length +
    dragonballScrollTiles.length +
    visiblePotionStacks.length +
    visibleItems.length
  const emptySlotCount = Math.max(0, INVENTORY_SLOT_CAP - occupiedCount)

  const selectedItem =
    selectedSlot?.kind === 'item' && !reservedItemIds.includes(selectedSlot.id)
      ? items.find((item) => item.id === selectedSlot.id)
      : undefined
  const selectedTemplate = selectedItem && templates.find((entry) => entry.id === selectedItem.template_id)
  // All 6 catalog slot_types (weapon/ring/necklace/boots/hat/coat) are
  // functional equip slots now (confirmed, 2026-07-31 — supersedes the
  // earlier "only Main Hand" restriction). This guard stays for safety/
  // forward-compat only — it'd only ever be false for a future slot_type
  // (e.g. a shield) that doesn't have a real paper-doll slot yet.
  const isEquippableSlot = Boolean(selectedTemplate && EQUIP_SLOTS.includes(selectedTemplate.slot_type as EquipSlot))
  // Bug fix: required_level was never actually enforced anywhere — only
  // ShopPanel's purchase gate checked it (`meetsLevel`, same pattern mirrored
  // here). Equipping went entirely ungated, so a level 1 character could wear
  // a level 130 item. Client-side only, same trust model as equipping itself
  // (there's no server-side equip check at all, gated or not).
  const meetsLevelRequirement = Boolean(selectedTemplate && characterLevel >= selectedTemplate.required_level)
  // GearEquipPopover-only (equipPopoverEnabled) — whatever's currently worn
  // in the same slot_type as the selected item, for the Compare view. null
  // when the slot is empty (first-time equip), in which case the popover
  // simply doesn't offer Compare at all (confirmed with the user).
  const equippedItemIdForSlot = selectedTemplate ? equippedIds[selectedTemplate.slot_type as EquipSlot] : null
  const equippedItemForSlot = equippedItemIdForSlot ? items.find((entry) => entry.id === equippedItemIdForSlot) : undefined
  const equippedTemplateForSlot = equippedItemForSlot && templates.find((entry) => entry.id === equippedItemForSlot.template_id)
  const compareTooltip =
    equippedItemForSlot && equippedTemplateForSlot ? buildGearTooltip(equippedItemForSlot, equippedTemplateForSlot) : null
  const selectedStoneTier = selectedSlot?.kind === 'stone' ? selectedSlot.tier : undefined
  const selectedPotionStack =
    selectedSlot?.kind === 'potion' ? visiblePotionStacks.find((stack) => stack.id === selectedSlot.id) : undefined
  const selectedCurrencyType = selectedSlot?.kind === 'currency' ? selectedSlot.currencyType : undefined
  const selectedScrollType = selectedSlot?.kind === 'scroll' ? selectedSlot.currencyType : undefined

  const slotKey = (slot: NonNullable<SelectedSlot>): string =>
    slot.kind === 'stone' || slot.kind === 'currency' || slot.kind === 'scroll' ? slot.dragId : `${slot.kind}:${slot.id}`

  // Fixed-size tracks (not grid-cols-N's equal-fraction columns) so tiles stay a
  // consistent size regardless of how wide the surrounding column/page is — matches
  // SLOT_SIZE_CLASS (InventorySlot.tsx), and the same sizes Forge's Upgrade/Fuel
  // slots use. Responsive to match: 3.5rem tracks below `lg` (matching h-14/w-14),
  // 4rem at `lg` and up (matching h-16/w-16, unchanged from before this was
  // responsive). Tailwind needs each literal spelled out somewhere so its scanner
  // picks it up — a template-literal class name wouldn't be found at build time.
  const gridColsClass =
    columns === 5
      ? 'grid-cols-[repeat(5,3.5rem)] lg:grid-cols-[repeat(5,4rem)]'
      : 'grid-cols-[repeat(8,3.5rem)] lg:grid-cols-[repeat(8,4rem)]'

  const toggleSlot = (slot: NonNullable<SelectedSlot>) => {
    setSelectedSlot((current) => (current && slotKey(current) === slotKey(slot) ? null : slot))
  }

  // GearEquipPopover-only — dismiss action, also used after a successful
  // Equip from inside the popover.
  const closeGearPopover = () => {
    setSelectedSlot(null)
    setPopoverAnchorRect(null)
  }

  // enableBankDeposit-only — dismiss action, also used after a successful
  // single-item Deposit from inside the popover.
  const closeBankPopover = () => {
    setSelectedSlot(null)
    setBankPopoverAnchorRect(null)
  }

  const handleBankDepositItem = async (itemId: string) => {
    if (!characterId) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositItem(characterId, itemId)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't deposit that item.")
      return
    }

    closeBankPopover()
  }

  const handleBankDepositStone = async (tier: number) => {
    if (!characterId) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositStone(characterId, tier, 1)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't deposit that stone.")
      return
    }

    closeBankPopover()
  }

  // Sequential, not Promise.all (deliberately unlike sellSelected below) —
  // deposit_item's client-side Storage-full pre-check reads Storage's own
  // occupied-slot count, which only grows when a genuinely new template gets
  // its first token; firing every deposit at once would read a stale
  // snapshot for each concurrent call and could under-count how many new
  // slots the batch actually needs. Awaiting one at a time keeps each
  // pre-check accurate against the real, just-updated state.
  const handleDepositAll = async () => {
    if (!characterId) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    let failures = 0

    for (const item of visibleItems) {
      if (reservedItemIds.includes(item.id)) {
        continue
      }
      const result = await depositItem(characterId, item.id)
      if (!result.ok) {
        failures += 1
      }
    }

    for (const tier of COMPOSITION_STONE_TIERS) {
      const owned = stones[String(tier)] ?? 0
      if (owned <= 0) {
        continue
      }
      const result = await depositStone(characterId, tier, owned)
      if (!result.ok) {
        failures += 1
      }
    }

    setBankDepositBusy(false)
    if (failures > 0) {
      setBankDepositError(`Couldn't deposit ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  const handleTileDrop = (overTarget: string | null, id: string) => {
    if (overTarget) {
      onTileDrop?.(overTarget, id)
    }
  }

  const handleSell = async (item: ItemInstance) => {
    setSellError(null)
    setSellBusy(true)
    const result = await sellItem(item.id)
    setSellBusy(false)

    if (!result.ok) {
      setSellError("Couldn't sell that item.")
      return
    }

    setSelectedSlot(null)
  }

  const handleBundle = async (currencyType: 'meteor' | 'dragonball') => {
    if (!characterId) {
      return
    }
    setScrollError(null)
    setScrollBusy(true)
    const result = await bundleScroll(characterId, currencyType)
    setScrollBusy(false)

    if (!result.ok) {
      setScrollError(result.error === 'not_enough_units' ? 'Need 10 to bundle.' : "Couldn't bundle.")
      return
    }

    setSelectedSlot(null)
  }

  const handleUnbundle = async (currencyType: 'meteor' | 'dragonball') => {
    if (!characterId) {
      return
    }
    setScrollError(null)
    setScrollBusy(true)
    const result = await unbundleScroll(characterId, currencyType)
    setScrollBusy(false)

    if (!result.ok) {
      setScrollError(result.error === 'not_enough_room' ? 'Not enough room for all 10.' : "Couldn't open.")
      return
    }

    setSelectedSlot(null)
  }

  const toggleSaleSelection = (itemId: string) => {
    setSelectedForSale((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  // Convenience shortcut for the common case (dumping junk) — doesn't stop
  // the player from also hand-picking higher-tier items via the checkboxes.
  const selectAllNormal = () => {
    setSelectedForSale(new Set(visibleItems.filter((item) => item.quality_tier === 'normal').map((item) => item.id)))
  }

  const saleTotal = visibleItems
    .filter((item) => selectedForSale.has(item.id))
    .reduce((sum, item) => {
      const template = templates.find((entry) => entry.id === item.template_id)
      return sum + previewSellPrice(template?.price ?? 0, item.quality_tier)
    }, 0)

  const sellSelected = async () => {
    setSellError(null)
    setSellBusy(true)
    // Parallel, not sequential (2026-08-01, fixes a visible "sells one at a
    // time" delay) — each sellItem call is an independent row delete with no
    // shared state to race on (see sell_item's own ownership-scoped
    // transaction), so there's no correctness reason to wait for one before
    // firing the next.
    const results = await Promise.all(Array.from(selectedForSale).map((itemId) => sellItem(itemId)))
    const failures = results.filter((result) => !result.ok).length
    setSellBusy(false)
    setSelectedForSale(new Set())
    if (failures > 0) {
      setSellError(`Couldn't sell ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Inventory ({occupiedCount}/{INVENTORY_SLOT_CAP})
          </p>

          {enableSelling && (
            <div className="flex items-center gap-2 text-xs">
              {sellError && <span className="text-amber-400">{sellError}</span>}
              <button
                type="button"
                onClick={selectAllNormal}
                className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500"
              >
                Select All Normal
              </button>
              <button
                type="button"
                disabled={selectedForSale.size === 0 || sellBusy}
                onClick={() => void sellSelected()}
                className="rounded border border-amber-600 bg-amber-500/10 px-2 py-1 font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sellBusy ? 'Selling…' : `Sell Selected (${saleTotal}g)`}
              </button>
            </div>
          )}

          {enableBankDeposit && (
            <div className="flex items-center gap-2 text-xs">
              {bankDepositError && <span className="text-amber-400">{bankDepositError}</span>}
              <button
                type="button"
                disabled={
                  bankDepositBusy ||
                  (visibleItems.length === 0 && COMPOSITION_STONE_TIERS.every((tier) => (stones[String(tier)] ?? 0) === 0))
                }
                onClick={() => void handleDepositAll()}
                className="rounded border border-sky-500 bg-sky-500/10 px-2 py-1 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {bankDepositBusy ? 'Depositing…' : 'Deposit All'}
              </button>
            </div>
          )}
        </div>

        {/* overflow-x-auto is a defensive backstop, not the primary fix — the
            responsive tile/track sizes above (SLOT_SIZE_CLASS/gridColsClass)
            should already fit any phone width; this just guarantees the grid
            scrolls within itself instead of blowing out the page if it ever
            doesn't (e.g. a future higher column count). data-drop-zone is
            inert unless a DragDropProvider ancestor is actively tracking a
            drag (see dragDropContext.ts) — harmless on every other page. */}
        <div data-drop-zone="inventory" className="mt-2 flex justify-center overflow-x-auto">
        <div className={`grid ${gridColsClass} gap-1.5`}>
          {visiblePotionStacks.map((stack) => {
            const type = POTION_TYPES[stack.potionType]
            const potionTooltip: ItemTooltipData = {
              title: type.displayName,
              icon: type.kind === 'hp' ? '🧪' : '💧',
              iconColor: CONSUMABLE_COLOR,
              lines: [type.kind === 'hp' ? 'HP Potion' : 'Mana Potion', `${stack.count} / ${type.stackSize}`],
              stats: [type.description],
            }

            return (
              <InventorySlot
                key={stack.id}
                slotId={stack.id}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon={type.kind === 'hp' ? '🧪' : '💧'}
                qualityColor={CONSUMABLE_COLOR}
                label={`${type.displayName} (${stack.count}/${type.stackSize})`}
                tooltip={potionTooltip}
                badge={`${stack.count}/${type.stackSize}`}
                selected={selectedSlot?.kind === 'potion' && selectedSlot.id === stack.id}
                onClick={() => toggleSlot({ kind: 'potion', id: stack.id })}
              />
            )
          })}

          {stoneTiles.map(({ tier, dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '🔷',
              qualityColor: MATERIAL_COLOR,
              label: `+${tier} Stone — ${compositionPointValue(tier)} pts`,
              tooltip: buildStoneTooltip(tier),
              selected: selectedSlot?.kind === 'stone' && selectedSlot.dragId === dragId,
            }

            const stoneSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '🔷' }}
                onDrop={handleTileDrop}
                onClick={() => toggleSlot({ kind: 'stone', dragId, tier })}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'stone', dragId, tier })} />
            )

            if (!enableBankDeposit) {
              return stoneSlot
            }

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setBankPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {stoneSlot}
              </div>
            )
          })}

          {meteorTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              iconSrc: METEOR_ICON_SRC,
              qualityColor: MATERIAL_COLOR,
              label: 'Meteor',
              tooltip: buildMeteorTooltip(),
              selected: selectedSlot?.kind === 'currency' && selectedSlot.dragId === dragId,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={dragId}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: dragId, icon: '☄️', iconSrc: METEOR_ICON_SRC, qualityColor: MATERIAL_COLOR }}
                  onDrop={handleTileDrop}
                  onClick={() => toggleSlot({ kind: 'currency', dragId, currencyType: 'meteor' })}
                />
              )
            }

            return (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'currency', dragId, currencyType: 'meteor' })} />
            )
          })}

          {dragonballTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              iconSrc: DRAGONBALL_ICON_SRC,
              qualityColor: DRAGONBALL_COLOR,
              label: 'DragonBall',
              tooltip: buildDragonballTooltip(),
              selected: selectedSlot?.kind === 'currency' && selectedSlot.dragId === dragId,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={dragId}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: dragId, icon: '🔮', iconSrc: DRAGONBALL_ICON_SRC, qualityColor: DRAGONBALL_COLOR }}
                  onDrop={handleTileDrop}
                  onClick={() => toggleSlot({ kind: 'currency', dragId, currencyType: 'dragonball' })}
                />
              )
            }

            return (
              <InventorySlot
                key={dragId}
                {...commonProps}
                onClick={() => toggleSlot({ kind: 'currency', dragId, currencyType: 'dragonball' })}
              />
            )
          })}

          {meteorScrollTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '📜',
              label: 'Meteor Scroll',
              tooltip: buildMeteorScrollTooltip(),
              selected: selectedSlot?.kind === 'scroll' && selectedSlot.dragId === dragId,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={dragId}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: dragId, icon: '📜' }}
                  onDrop={handleTileDrop}
                  onClick={() => toggleSlot({ kind: 'scroll', dragId, currencyType: 'meteor' })}
                />
              )
            }

            return (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'scroll', dragId, currencyType: 'meteor' })} />
            )
          })}

          {dragonballScrollTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '📜',
              label: 'DragonBall Scroll',
              tooltip: buildDragonballScrollTooltip(),
              selected: selectedSlot?.kind === 'scroll' && selectedSlot.dragId === dragId,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={dragId}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: dragId, icon: '📜' }}
                  onDrop={handleTileDrop}
                  onClick={() => toggleSlot({ kind: 'scroll', dragId, currencyType: 'dragonball' })}
                />
              )
            }

            return (
              <InventorySlot
                key={dragId}
                {...commonProps}
                onClick={() => toggleSlot({ kind: 'scroll', dragId, currencyType: 'dragonball' })}
              />
            )
          })}

          {visibleItems.map((item) => {
            if (reservedItemIds.includes(item.id)) {
              return <InventorySlot key={item.id} slotId={item.id} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const template = templates.find((entry) => entry.id === item.template_id)
            const label = template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'
            const qualityColor = getQualityColor(item.quality_tier)
            const icon = getItemIcon(template?.slot_type)
            const iconSrc = getGearIconSrc(template?.name)

            const commonProps = {
              slotId: item.id,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              qualityColor,
              icon,
              iconSrc,
              label,
              // Omitted when equipPopoverEnabled/enableBankDeposit — both
              // modes' whole point is "press is the only trigger now," so the
              // plain hover/long-press peek this prop drives is dropped for
              // these tiles specifically (native `title` still works as a
              // bare-bones desktop fallback, same as any other tile with no
              // tooltip).
              tooltip: equipPopoverEnabled || enableBankDeposit ? undefined : buildGearTooltip(item, template),
              selected: selectedSlot?.kind === 'item' && selectedSlot.id === item.id,
            }

            // Merged (2026-08-03, was two separate early-return branches) so
            // the popover wrappers below can apply regardless of whether this
            // instance also has onTileDrop wired up (WarehousePanel's
            // Inventory grid now wants both: drag-to-deposit stays working,
            // click-to-open-the-Deposit-popover is additive) — no existing
            // caller combined onTileDrop with enableSelling/equipPopoverEnabled,
            // so this doesn't change behavior for Forge/Marketplace's own
            // onTileDrop-only embeddings.
            const slot = onTileDrop ? (
              <DraggableInventorySlot
                key={item.id}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: item.id, icon, iconSrc, qualityColor }}
                onDrop={handleTileDrop}
                onClick={() => toggleSlot({ kind: 'item', id: item.id })}
              />
            ) : (
              <InventorySlot key={item.id} {...commonProps} onClick={() => toggleSlot({ kind: 'item', id: item.id })} />
            )

            // GearEquipPopover (Inventory grid only, see equipPopoverEnabled's
            // own doc comment) — wraps the tile so its click also captures the
            // tile's own bounding rect for the popover to anchor against.
            // data-gear-popover-anchor is what tells GearEquipPopover's
            // outside-click listener this click was on a gear tile (any of
            // them, not just the open one) rather than genuinely "outside,"
            // see that component for why. Mirrors the enableSelling wrapper
            // pattern immediately below — this codebase's established way to
            // add an opt-in overlay/behavior to a tile without touching
            // InventorySlot itself.
            if (equipPopoverEnabled) {
              return (
                <div
                  key={item.id}
                  data-gear-popover-anchor
                  onClick={(event) => setPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
                >
                  {slot}
                </div>
              )
            }

            // TooltipActionPopover (Deposit, Bank-tab Inventory grid only) —
            // same anchor-capturing wrapper pattern as equipPopoverEnabled
            // above, its own data attribute so the two modes' outside-click
            // listeners never mistake one for the other.
            if (enableBankDeposit) {
              return (
                <div
                  key={item.id}
                  data-tooltip-action-anchor
                  onClick={(event) => setBankPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
                >
                  {slot}
                </div>
              )
            }

            // Bulk-sell checkbox (Shop only, confirmed with the user, 2026-07-31) —
            // an overlay on top of the tile rather than a change to InventorySlot
            // itself, so every other embedding is unaffected. stopPropagation keeps
            // checking a box from also opening the detail card underneath it.
            if (!enableSelling) {
              return slot
            }

            return (
              <div key={item.id} className="relative">
                {slot}
                <input
                  type="checkbox"
                  checked={selectedForSale.has(item.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggleSaleSelection(item.id)}
                  className="absolute left-1 top-1 h-3.5 w-3.5 cursor-pointer accent-amber-500"
                  aria-label={`Select ${label} for bulk sale`}
                />
              </div>
            )
          })}

          {Array.from({ length: emptySlotCount }, (_, index) => (
            <InventorySlot key={`empty-${index}`} slotId={`empty-${index}`} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
          ))}
        </div>
        </div>
      </div>

      {selectedStoneTier !== undefined && !enableBankDeposit && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg"
              style={{ borderColor: MATERIAL_COLOR, backgroundColor: `${MATERIAL_COLOR}22` }}
            >
              🔷
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">+{selectedStoneTier} Stone</p>
              <p className="text-xs text-slate-500">
                {compositionPointValue(selectedStoneTier)} pts · {stones[String(selectedStoneTier)] ?? 0} owned total
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedCurrencyType && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg"
              style={{
                borderColor: selectedCurrencyType === 'meteor' ? MATERIAL_COLOR : DRAGONBALL_COLOR,
                backgroundColor: `${selectedCurrencyType === 'meteor' ? MATERIAL_COLOR : DRAGONBALL_COLOR}22`,
              }}
            >
              <img
                src={selectedCurrencyType === 'meteor' ? METEOR_ICON_SRC : DRAGONBALL_ICON_SRC}
                alt=""
                className="h-3/5 w-3/5 object-contain"
              />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{selectedCurrencyType === 'meteor' ? 'Meteor' : 'DragonBall'}</p>
              <p className="text-xs text-slate-500">
                {selectedCurrencyType === 'meteor' ? meteors : dragonballs} owned total
              </p>
            </div>
          </div>

          {(() => {
            const owned = selectedCurrencyType === 'meteor' ? meteors : dragonballs
            const disabled = owned < 10 || scrollBusy

            return (
              <button
                type="button"
                disabled={disabled}
                title={owned < 10 ? 'Need 10 to bundle' : undefined}
                onClick={() => void handleBundle(selectedCurrencyType)}
                className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  disabled
                    ? 'cursor-not-allowed border-slate-800 text-slate-600'
                    : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                }`}
              >
                {scrollBusy ? 'Bundling…' : 'Bundle (10 → 1 Scroll)'}
              </button>
            )
          })()}
          {scrollError && <p className="mt-2 text-xs text-amber-400">{scrollError}</p>}
        </div>
      )}

      {selectedScrollType && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg">
              📜
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {selectedScrollType === 'meteor' ? 'Meteor Scroll' : 'DragonBall Scroll'}
              </p>
              <p className="text-xs text-slate-500">
                {selectedScrollType === 'meteor' ? meteorScrolls : dragonballScrolls} owned total
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={scrollBusy}
            onClick={() => void handleUnbundle(selectedScrollType)}
            className="mt-3 w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {scrollBusy ? 'Opening…' : 'Open (→ 10 loose)'}
          </button>
          {scrollError && <p className="mt-2 text-xs text-amber-400">{scrollError}</p>}
        </div>
      )}

      {selectedPotionStack && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg"
              style={{ borderColor: CONSUMABLE_COLOR, backgroundColor: `${CONSUMABLE_COLOR}22` }}
            >
              {POTION_TYPES[selectedPotionStack.potionType].kind === 'hp' ? '🧪' : '💧'}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{POTION_TYPES[selectedPotionStack.potionType].displayName}</p>
              <p className="text-xs text-slate-500">{POTION_TYPES[selectedPotionStack.potionType].description}</p>
              <p className="text-xs text-slate-500">
                {selectedPotionStack.count} / {POTION_TYPES[selectedPotionStack.potionType].stackSize}
              </p>
            </div>
          </div>

          {(() => {
            const type = POTION_TYPES[selectedPotionStack.potionType]
            const isMana = type.kind === 'mp'
            const hpFull = type.kind === 'hp' && maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp
            const disabled = isMana || hpFull
            const label = isMana ? 'Nothing to restore yet' : hpFull ? 'HP already full' : 'Use'

            return (
              <button
                type="button"
                disabled={disabled}
                title={isMana ? 'No ability/skill system exists yet to spend MP on' : hpFull ? 'HP already full' : undefined}
                onClick={() => void handlePotionUse(selectedPotionStack.id)}
                className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  disabled
                    ? 'cursor-not-allowed border-slate-800 text-slate-600'
                    : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                }`}
              >
                {label}
              </button>
            )
          })()}
        </div>
      )}

      {selectedItem && !equipPopoverEnabled && !enableBankDeposit && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
              style={{ borderColor: getQualityColor(selectedItem.quality_tier) }}
            >
              {getGearIconSrc(selectedTemplate?.name) ? (
                <img src={getGearIconSrc(selectedTemplate?.name)} alt="" className="h-3/5 w-3/5 object-contain" />
              ) : (
                getItemIcon(selectedTemplate?.slot_type)
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {selectedTemplate
                  ? formatItemDisplayName(selectedTemplate.name, selectedItem.quality_tier, selectedItem.composition_level)
                  : 'Unknown item'}
              </p>
              <p className="text-xs text-slate-500">{formatItemLevel(selectedItem.level)}</p>
              {selectedTemplate && (
                <p className="text-xs text-slate-500">{formatBaseStats(selectedTemplate.base_stats, selectedItem.quality_tier)}</p>
              )}
              {selectedTemplate && selectedTemplate.required_level > 1 && (
                <p className={meetsLevelRequirement ? 'text-xs text-slate-500' : 'text-xs text-amber-500'}>
                  Requires level {selectedTemplate.required_level}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={isEquipped(selectedItem.id) || !isEquippableSlot || !meetsLevelRequirement}
            title={
              !isEquippableSlot
                ? "This slot isn't wearable yet"
                : !meetsLevelRequirement
                  ? `Requires level ${selectedTemplate?.required_level}`
                  : undefined
            }
            onClick={() =>
              selectedTemplate && meetsLevelRequirement && setEquippedItem(selectedTemplate.slot_type as EquipSlot, selectedItem.id)
            }
            className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
              isEquipped(selectedItem.id) || !isEquippableSlot || !meetsLevelRequirement
                ? 'cursor-not-allowed border-slate-800 text-slate-600'
                : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
            }`}
          >
            {isEquipped(selectedItem.id)
              ? 'Equipped'
              : !isEquippableSlot
                ? 'Not wearable yet'
                : !meetsLevelRequirement
                  ? `Requires level ${selectedTemplate?.required_level}`
                  : 'Equip'}
          </button>

          {enableSelling && (
            <button
              type="button"
              disabled={isEquipped(selectedItem.id) || sellBusy}
              onClick={() => void handleSell(selectedItem)}
              className="mt-2 w-full rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sellBusy
                ? 'Selling…'
                : `Sell (${previewSellPrice(selectedTemplate?.price ?? 0, selectedItem.quality_tier)} gold)`}
            </button>
          )}
          {sellError && <p className="mt-2 text-xs text-amber-400">{sellError}</p>}
        </div>
      )}

      {equipPopoverEnabled && selectedItem && popoverAnchorRect && (
        <GearEquipPopover
          anchorRect={popoverAnchorRect}
          tooltip={buildGearTooltip(selectedItem, selectedTemplate)}
          compareTooltip={compareTooltip}
          alreadyEquipped={isEquipped(selectedItem.id)}
          canEquip={!isEquipped(selectedItem.id) && isEquippableSlot && meetsLevelRequirement}
          equipLabel={
            isEquipped(selectedItem.id)
              ? 'Equipped'
              : !isEquippableSlot
                ? 'Not wearable yet'
                : !meetsLevelRequirement
                  ? `Requires level ${selectedTemplate?.required_level}`
                  : 'Equip'
          }
          onEquip={() => {
            if (selectedTemplate && meetsLevelRequirement) {
              setEquippedItem(selectedTemplate.slot_type as EquipSlot, selectedItem.id)
            }
          }}
          onClose={closeGearPopover}
        />
      )}

      {enableBankDeposit && selectedItem && bankPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankPopoverAnchorRect}
          tooltip={buildGearTooltip(selectedItem, selectedTemplate)}
          actions={[
            {
              label: bankDepositBusy ? 'Depositing…' : 'Deposit',
              onClick: () => void handleBankDepositItem(selectedItem.id),
              disabled: bankDepositBusy,
            },
          ]}
          onClose={closeBankPopover}
        />
      )}

      {enableBankDeposit && selectedStoneTier !== undefined && bankPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankPopoverAnchorRect}
          tooltip={buildStoneTooltip(selectedStoneTier)}
          actions={[
            {
              label: bankDepositBusy ? 'Depositing…' : 'Deposit',
              onClick: () => void handleBankDepositStone(selectedStoneTier),
              disabled: bankDepositBusy,
            },
          ]}
          onClose={closeBankPopover}
        />
      )}
    </div>
  )
}
