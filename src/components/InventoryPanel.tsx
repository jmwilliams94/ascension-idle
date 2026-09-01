import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { DraggableInventorySlot } from './dragDrop'
import { useIsDropTarget } from './dragDropContext'
import GearEquipPopover from './GearEquipPopover'
import TooltipActionPopover from './TooltipActionPopover'
import { Button } from './ui/Button'
import {
  buildGearTooltip,
  computeMaxDurability,
  formatBaseStats,
  formatItemDisplayName,
  formatItemLevel,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  itemHasDurability,
  previewSellPrice,
} from '../game/items/equipmentBonus'
import { EQUIP_SLOTS, useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
import {
  COMPOSITION_STONE_TIERS,
  CONSUMABLE_COLOR,
  FALLEN_STAR_COLOR,
  FALLEN_STAR_ICON_SRC,
  FALLEN_STAR_SCROLL_ICON_SRC,
  MATERIAL_COLOR,
  COMET_ICON_SRC,
  COMET_SCROLL_ICON_SRC,
  COMET_BOX_ICON_SRC,
  COMET_BOX_REWARD_AMOUNT,
  VIP_TOKEN_COLOR,
  VIP_TOKEN_DURATION_DAYS,
  VIP_TOKEN_ICON_SRC,
  EXPERIENCE_POTION_DURATION_HOURS,
  EXPERIENCE_ORB_ICON_SRC,
  EXPERIENCE_POTION_ICON_SRC,
  buildFallenStarScrollTooltip,
  buildFallenStarTooltip,
  buildCometScrollTooltip,
  buildCometTooltip,
  buildCometBoxTooltip,
  buildVipTokenTooltip,
  buildExperienceOrbTooltip,
  buildExperiencePotionTooltip,
  buildStoneTooltip,
  buildMoneyBagTooltip,
  buildGemBagTooltip,
  compositionPointValue,
  fallenStarDragId,
  fallenStarScrollDragId,
  cometDragId,
  cometScrollDragId,
  cometBoxDragId,
  vipTokenDragId,
  experienceOrbDragId,
  experiencePotionDragId,
  getStoneIconSrc,
  stoneDragId,
} from '../game/items/forgeCosts'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { useCompositionStore } from '../game/items/useCompositionStore'
import { useGemStore } from '../game/items/useGemStore'
import {
  gemDragId,
  buildGemTooltip,
  getGemIconSrc,
  getGemTierColor,
  formatGemTierLabel,
  gemCount,
  GEM_TYPE_ORDER,
  GEM_TIERS,
  GEM_TYPES,
  type GemTier,
  type GemTypeId,
} from '../game/items/gemTypes'
import { INVENTORY_SLOT_CAP, useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { useMarketplaceStore } from '../game/marketplace/useMarketplaceStore'
import { useMailStore } from '../game/marketplace/useMailStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { CLASS_DEFINITIONS } from '../game/stats/classes'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { equipPickaxe } from '../game/mining/pickaxeEquipActions'
import { POTION_TYPES, type PotionTypeId } from '../game/items/potionTypes'
import { useBankStore } from '../game/items/useBankStore'
import { useGainToastStore } from '../game/hud/useGainToastStore'
import { useMoneyBagRevealStore } from '../game/items/useMoneyBagRevealStore'
import { useGearSnapshotStore, type ScoredSlot } from '../game/items/useGearSnapshotStore'
import { useGearClaimPromptStore } from '../game/items/useGearClaimPromptStore'

// A single fixed 40-cell grid shared by gear (item_instances), Composition
// stones, Comets/Fallen Stars (+ their Scrolls), and HP/Mana potion stacks —
// a stack/stone/currency unit takes up a slot exactly like a gear item does,
// all counting against the same cap (see occupiedSlotCount in
// useInventoryStore). Always renders all 40 cells, empty ones
// dimmed/unclickable, so Forge's drag-and-drop has a stable, always-present
// set of slots to pick gear/stones up from.
type SelectedSlot =
  | { kind: 'item'; id: string }
  | { kind: 'stone'; dragId: string; tier: number }
  | { kind: 'gem'; dragId: string; gemId: GemTypeId; tier: GemTier }
  | { kind: 'potion'; id: string }
  | { kind: 'currency'; dragId: string; currencyType: 'comet' | 'fallen_star' }
  | { kind: 'scroll'; dragId: string; currencyType: 'comet' | 'fallen_star' }
  | { kind: 'comet_box'; dragId: string }
  | { kind: 'vip_token'; dragId: string }
  | { kind: 'experience_orb'; dragId: string }
  | { kind: 'experience_potion'; dragId: string }
  | null

interface InventoryPanelProps {
  // Gear items/stone tiers currently sitting in Forge's Upgrade Slot and/or Fuel
  // zone (if any) — their cells render empty here instead of filled, so nothing is
  // ever shown in two Forge drop targets (or the grid and a drop target) at once.
  // Stone tiers use the synthetic id from stoneDragId, real items use their own id.
  // Only ForgePanel passes this; every other usage is unaffected.
  reservedItemIds?: string[]
  // Present when rendered inside Forge or the Bank — makes gear and stone
  // tiles draggable (see dragDrop.tsx), calling back with whichever
  // data-drop-zone target (Forge: ForgeUpgradeSlot/ForgeMaterialSlot; Bank:
  // BankGrid's own storage grid) the tile was released over, and the
  // dragged id (a real item id, or a synthetic stoneDragId for a stone). Not
  // called if the tile was dropped somewhere with no valid target. Stones
  // don't stack — each tile is exactly one stone, so dragging one tile feeds
  // exactly one; feeding more means dragging in more individual tiles. The
  // grid area itself always carries data-drop-zone="inventory" (below) so a
  // tile dragged the other way — e.g. from BankGrid — can land back here,
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
  // directly into the same hover-tooltip-styled card. Originally also
  // dropped the plain hover/long-press peek for these tiles ("press is now
  // the only trigger") — reverted (2026-08-04, reported by the user: hover
  // tooltips stopped working on the Combat page) — the normal hover tooltip
  // stays on regardless of this flag now, click-for-the-popover is additive.
  // Only CombatPage's two InventoryPanel instances pass this — Forge/
  // Bank/Shop/Marketplace's own embeddings are unaffected, since their
  // click already means something else there (drag source, sell selection,
  // listing source) that this popover isn't designed around.
  equipPopoverEnabled?: boolean
  // Bank-tab-only. Mirrors equipPopoverEnabled's own click-opens-actionable-
  // tooltip pattern: clicking a gear, stone, Comet, or Fallen Star tile opens
  // a TooltipActionPopover showing that tile's own tooltip plus "Deposit"/
  // "Deposit All" (physical Bank Storage — deposit_item_to_storage/
  // bank_stone_item/bank_currency_item) and, where applicable, "Bank"/
  // "Bank All" (liquidate to currency/points — deposit_item_as_composition/
  // transfer_stone/transfer_currency; hidden for a still-Normal gear item,
  // which has nothing to bank — Bank tab rework, 2026-08-03, confirmed with
  // the user). Only BankPanel's Inventory-grid embedding passes this.
  // Potions and Scrolls are out of scope (confirmed with the user) and stay
  // exactly as they were — Scrolls keep their existing Bundle/Unbundle card.
  enableBankDeposit?: boolean
  // Equipment-tab-only (2026-08-13, requested by the user) — adds a "Compare"
  // toggle button above the grid. While on, every gear tile's hover peek
  // shows the side-by-side compare view (this tile vs. whatever's equipped
  // in the same slot) instead of just its own tooltip, and the tap-opened
  // GearEquipPopover shows that same comparison automatically with no button
  // of its own (see GearEquipPopover's autoCompare prop) — replacing the
  // old per-tile "open the popover, then press Compare" flow. Also disables
  // the long-press touch trigger on these tiles (see HoverTooltip's
  // disableTouchPeek) since a plain tap already opens the popover showing
  // the same content, making long-press a redundant second gesture here.
  // Only CombatPage's equipPopoverEnabled-only embedding is unaffected by
  // this — it doesn't pass this prop, so it keeps today's in-popover
  // Compare button and long-press peek unchanged.
  enableCompareToggle?: boolean
  // Mobile equivalent of the shift-click shortcut above (2026-09-01,
  // requested by the user — "windows has shift-click, mobile needs
  // something too"). Forge/Composition/Sockets/Enchantress are the only
  // callers that pass this: their plain (non-shift) tap already had no
  // effect of its own on these pages (toggleSlot's `selected` state isn't
  // read by anything outside this component here — the parent panel only
  // ever learns about a placed item via onTileDrop), so making every tap
  // act like a shift-click is a strict improvement with nothing to lose,
  // and it removes the desktop-only shift requirement for those users too.
  // Left off (default) everywhere else, since a plain tap already means
  // something else on those pages (select-for-detail-card on Marketplace/
  // Salvage, open GearEquipPopover on Combat, etc.) that this would
  // short-circuit.
  tapToPlaceEnabled?: boolean
  // Optional eligibility check (2026-09-02, requested by the user for
  // Forge's Standard tab) — when supplied, any filled tile whose id fails
  // this check renders dimmed (opacity + grayscale, see InventorySlot's
  // `dimmed` prop) instead of full-strength. Purely visual — dragging/
  // tapping a dimmed tile still fires onTileDrop as normal; the parent's
  // own drop handler is what actually rejects it (e.g. ForgeStandardPanel's
  // handleDropItemId/handleDropMaterial already no-op on a mismatched
  // type). Lets a panel like Forge visually signal "gear only, right now"
  // vs. "Comets/Fallen Stars/Scrolls only, right now" without this
  // component needing to know anything about Forge's own two-phase flow.
  isTileEligible?: (dragId: string) => boolean
}

// Isolated so only this tiny button subscribes to the live HP/MP that ticks
// every 100ms while combat runs in the background (CombatEngine.tsx) —
// InventoryPanel itself used to select currentPlayerHp/maxPlayerHp/
// currentPlayerMp/maxPlayerMp directly, which meant the *entire* grid (every
// InventorySlot, plus every Forge/Bank/Shop screen that embeds this same
// component) re-rendered up to 10x/second any time the player was fighting,
// regardless of which tab was open. Same shape as ZoneBossCard's spawn-
// object-in-deps bug (v1.116.7) — subscribing to something that changes far
// more often than what's actually being computed from it, at the top of a
// component big enough that the re-render cost isn't free.
function PotionUseButton({ potionType, onUse }: { potionType: PotionTypeId; onUse: () => void }) {
  const currentPlayerHp = useCombatStore((state) => state.currentPlayerHp)
  const maxPlayerHp = useCombatStore((state) => state.maxPlayerHp)
  const currentPlayerMp = useCombatStore((state) => state.currentPlayerMp)
  const maxPlayerMp = useCombatStore((state) => state.maxPlayerMp)

  const type = POTION_TYPES[potionType]
  const hpFull = type.kind === 'hp' && maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp
  const mpFull = type.kind === 'mp' && maxPlayerMp > 0 && currentPlayerMp >= maxPlayerMp
  const disabled = hpFull || mpFull
  const label = hpFull ? 'HP already full' : mpFull ? 'MP already full' : 'Use'

  return (
    <button
      type="button"
      disabled={disabled}
      title={hpFull ? 'HP already full' : mpFull ? 'MP already full' : undefined}
      onClick={onUse}
      className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
        disabled
          ? 'cursor-not-allowed border-slate-800 text-slate-600'
          : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
      }`}
    >
      {label}
    </button>
  )
}

export default function InventoryPanel({
  reservedItemIds = [],
  onTileDrop,
  enableSelling = false,
  columns = 8,
  equipPopoverEnabled = false,
  enableBankDeposit = false,
  enableCompareToggle = false,
  tapToPlaceEnabled = false,
  isTileEligible,
}: InventoryPanelProps) {
  const dimmedFor = (dragId: string) => (isTileEligible ? !isTileEligible(dragId) : false)
  const items = useInventoryStore((state) => state.items)
  const sellItem = useInventoryStore((state) => state.sellItem)
  const openRewardItem = useInventoryStore((state) => state.openRewardItem)
  const showMoneyBagReveal = useMoneyBagRevealStore((state) => state.show)
  const templates = useItemTemplatesStore((state) => state.templates)
  const setEquippedItem = useEquipmentStore((state) => state.setEquippedItem)
  // Subscribe to equippedIds itself, not the isEquipped function — isEquipped's
  // reference never changes (it's set once at store creation), so selecting it
  // directly never re-renders this component when equipment actually changes,
  // only whenever something else forces a re-render (e.g. selecting a tile).
  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  // Pickaxe (2026-10-24) has its own equip pointer, independent of the 7
  // useEquipmentStore slots — folded into this same isEquipped check so
  // every existing call site (visibleItems' hide-from-grid filter, the
  // Equip button's disabled/label state, GearEquipPopover's
  // alreadyEquipped/canEquip) treats an equipped Pickaxe consistently with
  // every other equipped item, with no separate branching needed downstream.
  const equippedPickaxeId = useCharacterRecordStore((state) => state.equippedPickaxeId)
  const isEquipped = (itemId: string) => Object.values(equippedIds).includes(itemId) || itemId === equippedPickaxeId
  const characterLevel = useProgressionStore((state) => state.level)

  const stones = useCompositionStore((state) => state.stones)
  const gems = useGemStore((state) => state.gems)
  const comets = useCurrencyStore((state) => state.comets)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const cometScrolls = useCurrencyStore((state) => state.cometScrolls)
  const fallenStarScrolls = useCurrencyStore((state) => state.fallenStarScrolls)
  const cometBoxes = useCurrencyStore((state) => state.cometBoxes)
  const vipTokens = useCurrencyStore((state) => state.vipTokens)
  const experienceOrbs = useCurrencyStore((state) => state.experienceOrbs)
  const experiencePotions = useCurrencyStore((state) => state.experiencePotions)
  const bundleScroll = useCurrencyStore((state) => state.bundleScroll)
  const unbundleScroll = useCurrencyStore((state) => state.unbundleScroll)
  const openCometBox = useBankStore((state) => state.openCometBox)
  // Named consumeVipToken, not useVipToken -- eslint's react-hooks plugin
  // treats any identifier starting with "use" as a hook, which would
  // wrongly flag handleUseVipToken's plain async call to it below. Same
  // reasoning for consumeExperienceOrb/consumeExperiencePotion below.
  const consumeVipToken = useBankStore((state) => state.useVipToken)
  const consumeExperienceOrb = useBankStore((state) => state.useExperienceOrb)
  const consumeExperiencePotion = useBankStore((state) => state.useExperiencePotion)
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const claimGearSnapshot = useGearSnapshotStore((state) => state.claimSnapshot)
  const showGearClaimPrompt = useGearClaimPromptStore((state) => state.show)
  const potionStacks = usePotionStore((state) => state.stacks)
  const handlePotionUse = usePotionStore((state) => state.usePotion)
  // Same "subscribe to the reactive data, not a stable selector-function
  // reference" fix as equippedIds above — myListings/mail entries, not
  // isListed/hasUnclaimedMail themselves.
  const myListings = useMarketplaceStore((state) => state.myListings)
  const isListed = (itemId: string) => myListings.some((listing) => listing.status === 'active' && listing.item_id === itemId)
  const mailEntries = useMailStore((state) => state.entries)
  const hasUnclaimedMail = (itemId: string) => mailEntries.some((entry) => entry.item_id === itemId && entry.claimed_at === null)
  const depositItemToStorage = useBankStore((state) => state.depositItemToStorage)
  // "Bank" (liquidate to currency/points), alongside "Deposit" (physical
  // storage, gear only now — see below) — the other half of the Bank tab
  // rework's per-item Deposit/Bank choice (2026-08-03, confirmed with the
  // user). Stone/Comet/Fallen-Star physical Deposit was retired 2026-08-07
  // (confirmed with the user) — Bank/Bank All (liquidate to points) plus
  // Bundle (Comet/Fallen Star only) are now the only ways to move those
  // through the Bank tab; gear keeps both Deposit and Bank.
  const depositItemAsComposition = useBankStore((state) => state.depositItemAsComposition)
  const depositStone = useBankStore((state) => state.depositStone)
  const depositGem = useBankStore((state) => state.depositGem)
  const depositCurrency = useBankStore((state) => state.depositCurrency)
  const showGainToast = useGainToastStore((state) => state.show)
  // Snap-highlight (2026-08-07) — a no-op false on any page without an
  // active DragDropProvider (Shop/Marketplace/Equipment/etc.), only ever
  // true here while Forge/Bank/Salvage's own drag is hovering back over
  // this grid.
  const isDropTarget = useIsDropTarget('inventory')

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
  // Comet/Fallen Star Bundle popover (every non-Bank instance) — same
  // click-opened TooltipActionPopover shell as the two above, replacing the
  // old always-below-the-grid Bundle card (2026-08-05, per the user: "I
  // would prefer to see it as a smaller option inside of the tooltip"
  // rather than its own separate card). Scroll's own Unbundle card is
  // unaffected — only the Comet/Fallen Star Bundle action moved.
  const [bundlePopoverAnchorRect, setBundlePopoverAnchorRect] = useState<DOMRect | null>(null)
  // Comet/Fallen Star Scroll "Open" popover — same click-opened
  // TooltipActionPopover shell as Bundle above, replacing the old
  // always-below-the-grid Unbundle card (2026-08-07, per the user: move it
  // into the tooltip like Bundle already is).
  const [scrollPopoverAnchorRect, setScrollPopoverAnchorRect] = useState<DOMRect | null>(null)
  // Comet Box "Open" popover (2026-08-25, redesigned from an instant grant
  // into a real inventory item) — same click-opened TooltipActionPopover
  // shell as the Scroll popover above, but its own state since Comet Box has
  // only one action (Open, no Bank/Bank All — opening already deposits
  // straight into the account's Bank balance, see forgeCosts.ts's
  // buildCometBoxTooltip) regardless of enableBankDeposit.
  const [cometBoxPopoverAnchorRect, setCometBoxPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [cometBoxBusy, setCometBoxBusy] = useState(false)
  const [cometBoxError, setCometBoxError] = useState<string | null>(null)
  // VIP Token "Use" popover (groundwork only) — same click-opened
  // TooltipActionPopover shell as the Comet Box popover above, own state
  // since VIP Token has its own single action (Use, no Bank/Bank All).
  const [vipTokenPopoverAnchorRect, setVipTokenPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [vipTokenBusy, setVipTokenBusy] = useState(false)
  const [vipTokenError, setVipTokenError] = useState<string | null>(null)
  // Experience Orb / Experience Potion "Use" popovers — same click-opened
  // TooltipActionPopover shell as VIP Token above, own state each since both
  // have a single action (Use, no Bank/Bank All).
  const [experienceOrbPopoverAnchorRect, setExperienceOrbPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [experienceOrbBusy, setExperienceOrbBusy] = useState(false)
  const [experienceOrbError, setExperienceOrbError] = useState<string | null>(null)
  const [experiencePotionPopoverAnchorRect, setExperiencePotionPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [experiencePotionBusy, setExperiencePotionBusy] = useState(false)
  const [experiencePotionError, setExperiencePotionError] = useState<string | null>(null)
  // Money Bag / Gem Bag "Open" popover (Lucky Lad rewards expansion,
  // 2026-08-09) — same click-opened TooltipActionPopover shell as the Scroll
  // popover above, but takes precedence over equipPopoverEnabled/
  // enableBankDeposit for these two item_family values regardless of which
  // InventoryPanel instance this is (see the item-tile render loop below).
  const [bagPopoverAnchorRect, setBagPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [bagBusy, setBagBusy] = useState(false)
  const [bagError, setBagError] = useState<string | null>(null)
  const [bankDepositBusy, setBankDepositBusy] = useState(false)
  const [bankDepositError, setBankDepositError] = useState<string | null>(null)
  const [sellBusy, setSellBusy] = useState(false)
  const [sellError, setSellError] = useState<string | null>(null)
  // Bundle/unbundle busy+error feedback (stage 2, 2026-07-31) — separate from
  // sellBusy/sellError since they're independent actions on different tiles.
  const [scrollBusy, setScrollBusy] = useState(false)
  const [scrollError, setScrollError] = useState<string | null>(null)
  // enableCompareToggle-only (Equipment tab) — see that prop's own doc comment.
  const [compareMode, setCompareMode] = useState(false)

  // Suppresses a tile's own hover/long-press tooltip peek specifically while
  // its own click-opened popover (GearEquipPopover, or a TooltipActionPopover
  // for Bank/Bundle/Sell) is showing (2026-08-05, reported by the user: "I'm
  // seeing normal tooltip and the press and hold tooltips at the same time
  // ... I think the hover ones can go now probably"). Root cause: a popover
  // already renders the exact same ItemTooltip content itself, so leaving the
  // peek active too let it visibly overlap the newly-opened popover — most
  // reliably for a mouse (hovering shows the peek, then clicking opens the
  // popover without the cursor ever leaving the tile, so the peek's own
  // onMouseLeave never fires to dismiss it). Deliberately scoped to only the
  // one tile whose popover is currently open, not a blanket removal — every
  // other tile's hover/long-press peek is unaffected, and this same tile's
  // own peek still works normally whenever its popover isn't open (keeps the
  // 2026-08-04 fix — "mouseover should still show the normal tooltip" — for
  // the common case where nothing is clicked).
  const isPopoverOpenForSelection = (matchesSelection: boolean) =>
    matchesSelection &&
    ((equipPopoverEnabled && popoverAnchorRect !== null) ||
      (enableBankDeposit && bankPopoverAnchorRect !== null) ||
      (!enableBankDeposit && bundlePopoverAnchorRect !== null) ||
      scrollPopoverAnchorRect !== null ||
      cometBoxPopoverAnchorRect !== null ||
      vipTokenPopoverAnchorRect !== null ||
      experienceOrbPopoverAnchorRect !== null ||
      experiencePotionPopoverAnchorRect !== null ||
      bagPopoverAnchorRect !== null)

  const visiblePotionStacks = potionStacks.filter((stack) => stack.count > 0)

  // The equipped item (if any) no longer shows here at all — once worn, it's
  // shown only in the Equipment tab's paper doll (confirmed, 2026-07-30), and
  // frees its Inventory slot (see occupiedSlotCount in useInventoryStore).
  // Un-equipping brings it straight back since this filter just stops matching.
  // Same hide-via-filter treatment (2026-08-02) for an actively-listed
  // Marketplace item and an item sitting in unclaimed Mail — see
  // useMarketplaceStore.isListed/useMailStore.hasUnclaimedMail. Same again
  // (2026-08-03) for a Bank-Storage item (location === 'bank') — shows only
  // in BankGrid's Storage grid once banked, same as an equipped item
  // shows only on the paper doll.
  const visibleItems = items.filter(
    (item) => item.location !== 'bank' && !isEquipped(item.id) && !isListed(item.id) && !hasUnclaimedMail(item.id),
  )

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

  // Comets/Fallen Stars don't stack either (same as Stones — confirmed with the
  // user, 2026-07-31) — one tile per owned unit, sharing the same remaining-
  // budget clamp, allocated after Stones in the same greedy fashion.
  // Gems (2026-08-09) — real, physical, non-stacking Inventory tiles now,
  // same greedy budget-clamp chain as Stones/Comets above. All 4 gem
  // types x 3 tiers are checked, even though only the 4 coded types
  // (Drake/Ember/Bastion/Iris) can ever actually be owned yet.
  const remainingAfterStonesBudget = Math.max(0, baseStoneBudget - stoneTiles.length)
  const gemTiles = GEM_TYPE_ORDER.flatMap((gemId) => GEM_TIERS.map((tier) => ({ gemId, tier, owned: gemCount(gems, gemId, tier) }))).reduce<
    { gemId: GemTypeId; tier: GemTier; index: number; dragId: string }[]
  >((acc, { gemId, tier, owned }) => {
    const shown = Math.min(owned, Math.max(0, remainingAfterStonesBudget - acc.length))

    for (let index = 0; index < shown; index += 1) {
      acc.push({ gemId, tier, index, dragId: gemDragId(gemId, tier, index) })
    }

    return acc
  }, [])

  const remainingAfterStones = Math.max(0, remainingAfterStonesBudget - gemTiles.length)
  const cometShown = Math.min(comets, remainingAfterStones)
  const cometTiles = Array.from({ length: cometShown }, (_, index) => ({ index, dragId: cometDragId(index) }))
  const remainingAfterComets = Math.max(0, remainingAfterStones - cometTiles.length)
  const fallenStarShown = Math.min(fallenStars, remainingAfterComets)
  const fallenStarTiles = Array.from({ length: fallenStarShown }, (_, index) => ({ index, dragId: fallenStarDragId(index) }))

  // Scrolls (stage 2, 2026-07-31) are their own non-stacking item too — one
  // tile per owned Scroll, allocated last in the same greedy chain.
  const remainingAfterFallenStars = Math.max(0, remainingAfterComets - fallenStarTiles.length)
  const cometScrollShown = Math.min(cometScrolls, remainingAfterFallenStars)
  const cometScrollTiles = Array.from({ length: cometScrollShown }, (_, index) => ({ index, dragId: cometScrollDragId(index) }))
  const remainingAfterCometScrolls = Math.max(0, remainingAfterFallenStars - cometScrollTiles.length)
  const fallenStarScrollShown = Math.min(fallenStarScrolls, remainingAfterCometScrolls)
  const fallenStarScrollTiles = Array.from({ length: fallenStarScrollShown }, (_, index) => ({
    index,
    dragId: fallenStarScrollDragId(index),
  }))

  // Comet Box (2026-08-25) is the same virtual-tile shape as the Scrolls
  // above — allocated last in the same greedy budget chain.
  const remainingAfterFallenStarScrolls = Math.max(0, remainingAfterCometScrolls - fallenStarScrollTiles.length)
  const cometBoxShown = Math.min(cometBoxes, remainingAfterFallenStarScrolls)
  const cometBoxTiles = Array.from({ length: cometBoxShown }, (_, index) => ({ index, dragId: cometBoxDragId(index) }))

  // VIP Token (groundwork only) — same virtual-tile shape as Comet Box
  // above, allocated last in the same greedy budget chain.
  const remainingAfterCometBoxes = Math.max(0, remainingAfterFallenStarScrolls - cometBoxTiles.length)
  const vipTokenShown = Math.min(vipTokens, remainingAfterCometBoxes)
  const vipTokenTiles = Array.from({ length: vipTokenShown }, (_, index) => ({ index, dragId: vipTokenDragId(index) }))

  // Experience Orb / Experience Potion — same virtual-tile shape as VIP
  // Token above, allocated last in the same greedy budget chain.
  const remainingAfterVipTokens = Math.max(0, remainingAfterCometBoxes - vipTokenTiles.length)
  const experienceOrbShown = Math.min(experienceOrbs, remainingAfterVipTokens)
  const experienceOrbTiles = Array.from({ length: experienceOrbShown }, (_, index) => ({
    index,
    dragId: experienceOrbDragId(index),
  }))
  const remainingAfterExperienceOrbs = Math.max(0, remainingAfterVipTokens - experienceOrbTiles.length)
  const experiencePotionShown = Math.min(experiencePotions, remainingAfterExperienceOrbs)
  const experiencePotionTiles = Array.from({ length: experiencePotionShown }, (_, index) => ({
    index,
    dragId: experiencePotionDragId(index),
  }))

  const occupiedCount =
    stoneTiles.length +
    gemTiles.length +
    cometTiles.length +
    fallenStarTiles.length +
    cometScrollTiles.length +
    fallenStarScrollTiles.length +
    cometBoxTiles.length +
    vipTokenTiles.length +
    experienceOrbTiles.length +
    experiencePotionTiles.length +
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
  const classId = useCharacterStore((state) => state.selectedClassId)
  // Bug fix (reported by the user — a Wuxia was able to equip Hunter gear):
  // required_class was likewise never enforced anywhere in equip, only used
  // for display (buildGearTooltip's "Class: ___" line) and at acquisition
  // time (Shop purchase/kill-drop filtering) — so any class-restricted item
  // that reached Inventory some other way (Marketplace trade, Mail, an item
  // that predates a class's own filtering) could still be equipped by any
  // class. null means genuinely class-agnostic (Boots/Pickaxe —
  // see the backfill migration 20261020000000_backfill_hunter_required_class.sql
  // for why nothing else is null). Same client-side-only trust model as
  // meetsLevelRequirement above.
  const meetsClassRequirement = Boolean(
    selectedTemplate && (selectedTemplate.required_class === null || selectedTemplate.required_class === classId),
  )
  const requiredClassLabel =
    selectedTemplate?.required_class && selectedTemplate.required_class in CLASS_DEFINITIONS
      ? CLASS_DEFINITIONS[selectedTemplate.required_class as keyof typeof CLASS_DEFINITIONS].displayName
      : undefined
  // Whatever's currently worn in the same slot_type as the given item, if
  // any — used both for the selected item's GearEquipPopover Compare view
  // and (enableCompareToggle only) every gear tile's own hover-compare peek.
  // Returns null when nothing's equipped in that slot (first-time equip),
  // in which case the caller simply doesn't offer/show Compare at all
  // (confirmed with the user).
  const buildCompareTooltipForItem = (template?: (typeof templates)[number]): ItemTooltipData | null => {
    const equippedItemId = template ? equippedIds[template.slot_type as EquipSlot] : null
    const equippedItem = equippedItemId ? items.find((entry) => entry.id === equippedItemId) : undefined
    const equippedTemplate = equippedItem && templates.find((entry) => entry.id === equippedItem.template_id)
    return equippedItem && equippedTemplate ? buildGearTooltip(equippedItem, equippedTemplate) : null
  }
  // GearEquipPopover-only (equipPopoverEnabled).
  const compareTooltip = buildCompareTooltipForItem(selectedTemplate)
  const selectedStoneTier = selectedSlot?.kind === 'stone' ? selectedSlot.tier : undefined
  const selectedGem = selectedSlot?.kind === 'gem' ? { gemId: selectedSlot.gemId, tier: selectedSlot.tier } : undefined
  const selectedPotionStack =
    selectedSlot?.kind === 'potion' ? visiblePotionStacks.find((stack) => stack.id === selectedSlot.id) : undefined
  const selectedCurrencyType = selectedSlot?.kind === 'currency' ? selectedSlot.currencyType : undefined
  const selectedScrollType = selectedSlot?.kind === 'scroll' ? selectedSlot.currencyType : undefined

  const slotKey = (slot: NonNullable<SelectedSlot>): string =>
    slot.kind === 'stone' ||
    slot.kind === 'gem' ||
    slot.kind === 'currency' ||
    slot.kind === 'scroll' ||
    slot.kind === 'comet_box' ||
    slot.kind === 'vip_token' ||
    slot.kind === 'experience_orb' ||
    slot.kind === 'experience_potion'
      ? slot.dragId
      : `${slot.kind}:${slot.id}`

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

  // Bundle popover-only — dismiss action, also used after a successful
  // Bundle from inside the popover.
  const closeBundlePopover = () => {
    setSelectedSlot(null)
    setBundlePopoverAnchorRect(null)
  }

  // Scroll popover-only — dismiss action, also used after a successful Open
  // from inside the popover.
  const closeScrollPopover = () => {
    setSelectedSlot(null)
    setScrollPopoverAnchorRect(null)
  }

  // Comet Box popover-only — dismiss action, also used after a successful
  // Open from inside the popover.
  const closeCometBoxPopover = () => {
    setSelectedSlot(null)
    setCometBoxPopoverAnchorRect(null)
  }

  // VIP Token popover-only — dismiss action, also used after a successful
  // Use from inside the popover.
  const closeVipTokenPopover = () => {
    setSelectedSlot(null)
    setVipTokenPopoverAnchorRect(null)
  }

  // Experience Orb / Experience Potion popover-only — same dismiss shape as
  // VIP Token above.
  const closeExperienceOrbPopover = () => {
    setSelectedSlot(null)
    setExperienceOrbPopoverAnchorRect(null)
  }

  const closeExperiencePotionPopover = () => {
    setSelectedSlot(null)
    setExperiencePotionPopoverAnchorRect(null)
  }

  // Bag popover-only — dismiss action, also used after a successful Open
  // from inside the popover.
  const closeBagPopover = () => {
    setSelectedSlot(null)
    setBagPopoverAnchorRect(null)
  }

  // Every enableBankDeposit handler below follows the same shape: deposit,
  // clear the popover on success, surface an error and leave it open on
  // failure. "All" variants are sequential, not Promise.all (deliberately
  // unlike sellAllNormal below) — deposit_item_to_storage/bank_stone_item/
  // bank_currency_item's client-side Storage-full pre-check reads Storage's
  // own occupied-slot count live; firing every deposit at once would read a
  // stale snapshot for each concurrent call.
  const handleBankDepositItem = async (itemId: string) => {
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositItemToStorage(itemId)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't deposit that item.")
      return
    }

    closeBankPopover()
  }

  const handleBankDepositAllGear = async () => {
    setBankDepositError(null)
    setBankDepositBusy(true)
    let failures = 0

    for (const item of visibleItems) {
      if (reservedItemIds.includes(item.id)) {
        continue
      }
      const result = await depositItemToStorage(item.id)
      if (!result.ok) {
        failures += 1
      }
    }

    setBankDepositBusy(false)
    if (failures > 0) {
      setBankDepositError(`Couldn't deposit ${failures} item${failures === 1 ? '' : 's'}.`)
    } else {
      closeBankPopover()
    }
  }

  // "Bank" handlers — liquidate into currency/points instead of physical
  // storage. Same shape/error-handling convention as the Deposit handlers
  // above, just calling the liquidation RPCs instead.
  const handleBankGear = async (itemId: string) => {
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositItemAsComposition(itemId)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't bank that item.")
      return
    }

    closeBankPopover()
  }

  // Scoped to visible gear with composition_level > 0 — an uncomposed item
  // has nothing to bank (see the composition_level > 0 guard on the
  // Bank/Bank All buttons themselves below).
  const handleBankAllGear = async () => {
    setBankDepositError(null)
    setBankDepositBusy(true)
    let failures = 0

    for (const item of visibleItems) {
      if (reservedItemIds.includes(item.id) || item.composition_level <= 0 || item.locked) {
        continue
      }
      const result = await depositItemAsComposition(item.id)
      if (!result.ok) {
        failures += 1
      }
    }

    setBankDepositBusy(false)
    if (failures > 0) {
      setBankDepositError(`Couldn't bank ${failures} item${failures === 1 ? '' : 's'}.`)
    } else {
      closeBankPopover()
    }
  }

  const handleBankStone = async (tier: number) => {
    if (!characterId) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositStone(characterId, tier, 1)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't bank that stone.")
      return
    }

    closeBankPopover()
  }

  const handleBankAllStone = async (tier: number) => {
    if (!characterId) {
      return
    }
    const owned = stones[String(tier)] ?? 0
    if (owned <= 0) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositStone(characterId, tier, owned)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't bank those stones.")
      return
    }

    closeBankPopover()
  }

  const handleBankGem = async (gemId: GemTypeId, tier: GemTier) => {
    if (!characterId) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositGem(characterId, gemId, tier, 1)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't bank that gem.")
      return
    }

    closeBankPopover()
  }

  const handleBankAllGem = async (gemId: GemTypeId, tier: GemTier) => {
    if (!characterId) {
      return
    }
    const owned = gemCount(gems, gemId, tier)
    if (owned <= 0) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositGem(characterId, gemId, tier, owned)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError("Couldn't bank those gems.")
      return
    }

    closeBankPopover()
  }

  const handleBankCurrency = async (currencyType: 'comet' | 'fallen_star') => {
    if (!characterId) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositCurrency(characterId, currencyType === 'comet' ? 'comets' : 'fallen_stars', 1)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError(`Couldn't bank that ${currencyType === 'comet' ? 'Comet' : 'Fallen Star'}.`)
      return
    }

    closeBankPopover()
  }

  const handleBankAllCurrency = async (currencyType: 'comet' | 'fallen_star') => {
    if (!characterId) {
      return
    }
    const owned = currencyType === 'comet' ? comets : fallenStars
    if (owned <= 0) {
      return
    }
    setBankDepositError(null)
    setBankDepositBusy(true)
    const result = await depositCurrency(characterId, currencyType === 'comet' ? 'comets' : 'fallen_stars', owned)
    setBankDepositBusy(false)

    if (!result.ok) {
      setBankDepositError(`Couldn't bank your ${currencyType === 'comet' ? 'Comets' : 'Fallen Stars'}.`)
      return
    }

    closeBankPopover()
  }

  // Banks a Scroll directly at full value (10 units) via the same
  // transfer_currency RPC the loose-unit Bank action already uses — its
  // deposit direction already auto-unbundles exactly enough Scrolls to cover
  // a shortfall in loose units (see 20260807040000_bank_withdraw_bundles_scrolls.sql),
  // so passing amount=10 (or a multiple, for Bank All) here banks straight
  // from Scrolls without first unbundling into loose Inventory tiles.
  const handleBankScroll = async (currencyType: 'comet' | 'fallen_star') => {
    if (!characterId) {
      return
    }
    setScrollError(null)
    setScrollBusy(true)
    const result = await depositCurrency(characterId, currencyType === 'comet' ? 'comets' : 'fallen_stars', 10)
    setScrollBusy(false)

    if (!result.ok) {
      setScrollError(`Couldn't bank that ${currencyType === 'comet' ? 'Comet' : 'Fallen Star'} Scroll.`)
      return
    }

    closeScrollPopover()
  }

  const handleBankAllScroll = async (currencyType: 'comet' | 'fallen_star') => {
    if (!characterId) {
      return
    }
    const scrollCount = currencyType === 'comet' ? cometScrolls : fallenStarScrolls
    if (scrollCount <= 0) {
      return
    }
    setScrollError(null)
    setScrollBusy(true)
    const result = await depositCurrency(characterId, currencyType === 'comet' ? 'comets' : 'fallen_stars', scrollCount * 10)
    setScrollBusy(false)

    if (!result.ok) {
      setScrollError(`Couldn't bank your ${currencyType === 'comet' ? 'Comet' : 'Fallen Star'} Scrolls.`)
      return
    }

    closeScrollPopover()
  }

  // Money Bag / Gem Bag "Open" — consumes the item, grants its wrapped
  // reward (see open_reward_item), then hands the result to
  // useMoneyBagRevealStore for the center-screen reveal card.
  const handleOpenBag = async (itemId: string) => {
    setBagError(null)
    setBagBusy(true)
    // Grabbed before the RPC call — open_reward_item deletes the item row on
    // success, so the template lookup (for the reveal card's icon) has to
    // happen off the pre-open local state.
    const bagItem = items.find((entry) => entry.id === itemId)
    const bagTemplate = bagItem ? templates.find((entry) => entry.id === bagItem.template_id) : undefined
    const result = await openRewardItem(itemId)
    setBagBusy(false)

    if (!result.ok || !result.granted) {
      setBagError("Couldn't open that.")
      return
    }

    closeBagPopover()
    if (result.granted.kind === 'gold') {
      showMoneyBagReveal({ kind: 'gold', amount: result.granted.amount, iconSrc: getGearIconSrc(bagTemplate?.name) })
    } else {
      showMoneyBagReveal({ kind: 'gem', gemId: result.granted.gem_id, tier: result.granted.tier })
    }
  }

  // Money Bag "Open All" — opens every Money Bag currently in the Inventory
  // (any class, not just the clicked tile's own), one open_reward_item call
  // at a time (sequential, not Promise.all, same reasoning as the "All"
  // deposit handlers above — and here it also avoids firing several
  // concurrent RPCs off one busy flag), then shows a single reveal card with
  // the summed gold total rather than one card per bag.
  const handleOpenAllBags = async () => {
    setBagError(null)
    setBagBusy(true)

    const moneyBagItems = items.filter((entry) => {
      const t = templates.find((tpl) => tpl.id === entry.template_id)
      return t?.item_family === 'money-bag'
    })

    let totalGold = 0
    let anyFailed = false

    for (const bagItem of moneyBagItems) {
      const result = await openRewardItem(bagItem.id)
      if (result.ok && result.granted?.kind === 'gold') {
        totalGold += result.granted.amount
      } else {
        anyFailed = true
      }
    }

    setBagBusy(false)
    closeBagPopover()

    if (totalGold > 0) {
      showMoneyBagReveal({ kind: 'gold', amount: totalGold })
    }
    if (anyFailed) {
      setBagError("Couldn't open all of your money bags.")
    }
  }

  const handleTileDrop = (overTarget: string | null, id: string) => {
    if (overTarget) {
      onTileDrop?.(overTarget, id)
    }
  }

  // Every scored equip slot except the weapon slot's Pickaxe placeholder
  // (never scored — see claim_gear_snapshot's own item_family guard).
  const SCORED_SLOTS = new Set<string>(['weapon', 'ring', 'necklace', 'boots', 'hat', 'coat'])

  // Gear Score Snapshot (requested by the user) — equipping already happens
  // unconditionally via setEquippedItem (unchanged); this additionally
  // tries to claim the Gear Score credit for this character. If the item is
  // currently snapshotted onto a different character, the RPC refuses
  // without writing anything and this shows the transfer-confirmation
  // prompt — declining leaves the equip as-is (the item is genuinely worn
  // here now) but the credit stays with whoever already had it.
  const handleEquip = (template: ItemTemplate, item: ItemInstance) => {
    // Pickaxe (2026-10-24) never goes into the weapon slot anymore — it has
    // its own dedicated equip pointer (equipped_pickaxe_id), reached from
    // this same Equip button as the guaranteed non-drag fallback to the
    // Mining tab's drag-and-drop slot (PickaxeEquipSlot). Gear Score doesn't
    // apply to it either way (see the guard below), so this branch returns
    // before ever reaching that logic.
    if (template.item_family === 'pickaxe') {
      if (characterId) void equipPickaxe(characterId, item.id)
      return
    }

    const slot = template.slot_type as EquipSlot
    setEquippedItem(slot, item.id)

    if (!characterId || !SCORED_SLOTS.has(slot)) {
      return
    }

    void claimGearSnapshot(characterId, slot as ScoredSlot, item.id).then((result) => {
      if (!result.ok && result.error === 'already_claimed') {
        showGearClaimPrompt({
          characterId,
          slot: slot as ScoredSlot,
          itemId: item.id,
          claimedByCharacterName: result.claimed_by_character_name ?? 'Another character',
        })
      }
    })
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

    if (typeof result.goldGained === 'number') {
      showGainToast({ label: 'Gold', amount: result.goldGained, icon: '💰', color: '#fbbf24' })
    }
    setSelectedSlot(null)
  }

  // Reused inside the Bank tab's currency popover too now (2026-08-07,
  // confirmed with the user — Bundle/Bank/Bank All replaces the old Deposit/
  // Deposit All/Bank/Bank All there), so it closes whichever popover state
  // is actually active rather than always the non-Bank one.
  const handleBundle = async (currencyType: 'comet' | 'fallen_star') => {
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

    if (enableBankDeposit) {
      closeBankPopover()
    } else {
      closeBundlePopover()
    }
  }

  const handleUnbundle = async (currencyType: 'comet' | 'fallen_star') => {
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

    closeScrollPopover()
  }

  const handleOpenCometBox = async () => {
    if (!characterId) {
      return
    }
    setCometBoxError(null)
    setCometBoxBusy(true)
    const result = await openCometBox(characterId)
    setCometBoxBusy(false)

    if (!result.ok) {
      setCometBoxError(result.error === 'not_enough_boxes' ? 'No Comet Boxes to open.' : "Couldn't open.")
      return
    }

    closeCometBoxPopover()
  }

  const handleUseVipToken = async () => {
    if (!characterId) {
      return
    }
    setVipTokenError(null)
    setVipTokenBusy(true)
    const result = await consumeVipToken(characterId)
    setVipTokenBusy(false)

    if (!result.ok) {
      setVipTokenError(result.error === 'not_enough_tokens' ? 'No VIP Tokens to use.' : "Couldn't use.")
      return
    }

    closeVipTokenPopover()
  }

  const handleUseExperienceOrb = async () => {
    if (!characterId) {
      return
    }
    setExperienceOrbError(null)
    setExperienceOrbBusy(true)
    const result = await consumeExperienceOrb(characterId)
    setExperienceOrbBusy(false)

    if (!result.ok) {
      setExperienceOrbError(
        result.error === 'not_enough_orbs' ? 'No Experience Orbs to use.' : result.error === 'max_level' ? 'Already max level.' : "Couldn't use.",
      )
      return
    }

    if (typeof result.exp_gained === 'number') {
      showGainToast({ label: 'EXP', amount: result.exp_gained, icon: '✨', color: '#4ADE80' })
    }

    closeExperienceOrbPopover()
  }

  const handleUseExperiencePotion = async () => {
    if (!characterId) {
      return
    }
    setExperiencePotionError(null)
    setExperiencePotionBusy(true)
    const result = await consumeExperiencePotion(characterId)
    setExperiencePotionBusy(false)

    if (!result.ok) {
      setExperiencePotionError(result.error === 'not_enough_potions' ? 'No Experience Potions to use.' : "Couldn't use.")
      return
    }

    closeExperiencePotionPopover()
  }

  // Excludes anything with composition progress (+N) even at Normal quality,
  // since that's no longer junk. Also excludes anything with an unlocked
  // socket (even an empty one) — sockets cost real Fallen Stars (weapons) or
  // a rare RNG proc (armor) to unlock, so that gear isn't junk either.
  const normalJunkItems = visibleItems.filter(
    (item) => item.quality_tier === 'normal' && item.composition_level === 0 && item.sockets.length === 0 && !item.locked,
  )

  const normalJunkTotal = normalJunkItems.reduce((sum, item) => {
    const template = templates.find((entry) => entry.id === item.template_id)
    const maxDurability = template ? computeMaxDurability(template.slot_type, template.required_level) : null
    const durabilityFraction = maxDurability ? Math.min(1, (item.durability ?? 0) / maxDurability) : 1
    return sum + previewSellPrice(template?.price ?? 0, item.quality_tier, durabilityFraction)
  }, 0)

  const sellAllNormal = async () => {
    setSellError(null)
    setSellBusy(true)
    // Parallel, not sequential (2026-08-01, fixes a visible "sells one at a
    // time" delay) — each sellItem call is an independent row delete with no
    // shared state to race on (see sell_item's own ownership-scoped
    // transaction), so there's no correctness reason to wait for one before
    // firing the next.
    const results = await Promise.all(normalJunkItems.map((item) => sellItem(item.id)))
    const failures = results.filter((result) => !result.ok).length
    setSellBusy(false)
    if (failures > 0) {
      setSellError(`Couldn't sell ${failures} item${failures === 1 ? '' : 's'}.`)
    }

    // One aggregate toast per bulk sell, not one per item — avoids a toast
    // pileup when selling a dozen items at once.
    const totalGold = results.reduce((sum, result) => sum + (result.goldGained ?? 0), 0)
    if (totalGold > 0) {
      showGainToast({ label: 'Gold', amount: totalGold, icon: '💰', color: '#fbbf24' })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-300">
            Inventory ({occupiedCount}/{INVENTORY_SLOT_CAP})
          </p>

          {enableCompareToggle && (
            <button
              type="button"
              onClick={() => setCompareMode((current) => !current)}
              className={`rounded border px-2 py-1 text-xs font-medium ${
                compareMode
                  ? 'border-slate-300 bg-slate-300/10 text-slate-100'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {compareMode ? 'Comparing ✓' : 'Compare'}
            </button>
          )}

          {enableSelling && (
            <div className="flex items-center gap-2 text-xs">
              {sellError && <span className="text-amber-400">{sellError}</span>}
              <Button
                variant="primary"
                disabled={normalJunkItems.length === 0 || sellBusy}
                onClick={() => void sellAllNormal()}
              >
                {sellBusy ? 'Selling…' : `Sell All Normal (${normalJunkTotal.toLocaleString()}g)`}
              </Button>
            </div>
          )}

          {enableBankDeposit && bankDepositError && (
            <span className="text-xs text-amber-400">{bankDepositError}</span>
          )}

          {scrollError && <span className="text-xs text-amber-400">{scrollError}</span>}
          {cometBoxError && <span className="text-xs text-amber-400">{cometBoxError}</span>}
          {vipTokenError && <span className="text-xs text-amber-400">{vipTokenError}</span>}
          {experienceOrbError && <span className="text-xs text-amber-400">{experienceOrbError}</span>}
          {experiencePotionError && <span className="text-xs text-amber-400">{experiencePotionError}</span>}
        </div>

        {/* overflow-x-auto is a defensive backstop, not the primary fix — the
            responsive tile/track sizes above (SLOT_SIZE_CLASS/gridColsClass)
            should already fit any phone width; this just guarantees the grid
            scrolls within itself instead of blowing out the page if it ever
            doesn't (e.g. a future higher column count). data-drop-zone is
            inert unless a DragDropProvider ancestor is actively tracking a
            drag (see dragDropContext.ts) — harmless on every other page. */}
        <div
          data-drop-zone="inventory"
          className={`mt-2 flex justify-center overflow-x-auto rounded-lg transition-shadow ${
            isDropTarget ? 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : ''
          }`}
        >
        <div className={`grid ${gridColsClass} gap-1.5`}>
          {visiblePotionStacks.map((stack) => {
            const type = POTION_TYPES[stack.potionType]
            const potionTooltip: ItemTooltipData = {
              title: type.displayName,
              icon: type.kind === 'hp' ? '🧪' : '💧',
              iconSrc: type.iconSrc,
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
                iconSrc={type.iconSrc}
                qualityColor={CONSUMABLE_COLOR}
                label={`${type.displayName} (${stack.count}/${type.stackSize})`}
                tooltip={potionTooltip}
                badge={`${stack.count}/${type.stackSize}`}
                selected={selectedSlot?.kind === 'potion' && selectedSlot.id === stack.id}
                dimmed={dimmedFor(stack.id)}
                onClick={() => toggleSlot({ kind: 'potion', id: stack.id })}
              />
            )
          })}

          {stoneTiles.map(({ tier, dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'stone' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '🔷',
              iconSrc: getStoneIconSrc(tier),
              iconSizeClassName: 'h-3/5 w-3/5',
              qualityColor: MATERIAL_COLOR,
              label: `+${tier} Stone — ${compositionPointValue(tier)} pts`,
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildStoneTooltip(tier),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const stoneSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '🔷', iconSrc: getStoneIconSrc(tier), qualityColor: MATERIAL_COLOR }}
                onDrop={handleTileDrop}
                onClick={(event) => {
                  // Same shift-click/tapToPlaceEnabled shortcut as the
                  // currency tiles above, routing to 'material' — Composition
                  // is the only current onTileDrop consumer that treats a
                  // stone as fuel; everyone else no-ops.
                  if (event.shiftKey || tapToPlaceEnabled) {
                    event.stopPropagation()
                    onTileDrop('material', dragId)
                    return
                  }
                  toggleSlot({ kind: 'stone', dragId, tier })
                }}
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

          {gemTiles.map(({ gemId, tier, dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'gem' && selectedSlot.dragId === dragId
            const gemColor = getGemTierColor(tier)
            const gemIconSrc = getGemIconSrc(gemId, tier)

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '💎',
              iconSrc: gemIconSrc,
              qualityColor: gemColor,
              label: `${formatGemTierLabel(tier)} ${GEM_TYPES[gemId].displayName}`,
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildGemTooltip(gemId, tier),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const gemSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '💎', iconSrc: gemIconSrc, qualityColor: gemColor }}
                onDrop={handleTileDrop}
                onClick={(event) => {
                  // Same shift-click/tapToPlaceEnabled shortcut as the other
                  // tile kinds above, routing to a generic 'gem' key —
                  // Enchantress is the only current onTileDrop consumer with
                  // an unambiguous single gem slot; Sockets (two sockets, no
                  // way to know which one a tap means) no-ops here and still
                  // needs a real drag onto the specific socket.
                  if (event.shiftKey || tapToPlaceEnabled) {
                    event.stopPropagation()
                    onTileDrop('gem', dragId)
                    return
                  }
                  toggleSlot({ kind: 'gem', dragId, gemId, tier })
                }}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'gem', dragId, gemId, tier })} />
            )

            if (!enableBankDeposit) {
              return gemSlot
            }

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setBankPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {gemSlot}
              </div>
            )
          })}

          {cometTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'currency' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              iconSrc: COMET_ICON_SRC,
              qualityColor: MATERIAL_COLOR,
              label: 'Comet',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildCometTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const cometSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '☄️', iconSrc: COMET_ICON_SRC, qualityColor: MATERIAL_COLOR }}
                onDrop={handleTileDrop}
                onClick={(event) => {
                  // Same shift-click shortcut as gear tiles above, targeting
                  // the 'material' drop-zone key instead — Forge/Composition
                  // are the only current onTileDrop consumers that check
                  // 'material'; everyone else no-ops. tapToPlaceEnabled is
                  // the mobile equivalent (see that prop's own doc comment).
                  if (event.shiftKey || tapToPlaceEnabled) {
                    event.stopPropagation()
                    onTileDrop('material', dragId)
                    return
                  }
                  toggleSlot({ kind: 'currency', dragId, currencyType: 'comet' })
                }}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'currency', dragId, currencyType: 'comet' })} />
            )

            if (!enableBankDeposit) {
              return (
                <div
                  key={dragId}
                  data-tooltip-action-anchor
                  onClick={(event) => setBundlePopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
                >
                  {cometSlot}
                </div>
              )
            }

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setBankPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {cometSlot}
              </div>
            )
          })}

          {fallenStarTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'currency' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              iconSrc: FALLEN_STAR_ICON_SRC,
              qualityColor: FALLEN_STAR_COLOR,
              label: 'Fallen Star',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildFallenStarTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const fallenStarSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '🔮', iconSrc: FALLEN_STAR_ICON_SRC, qualityColor: FALLEN_STAR_COLOR }}
                onDrop={handleTileDrop}
                onClick={(event) => {
                  if (event.shiftKey || tapToPlaceEnabled) {
                    event.stopPropagation()
                    onTileDrop('material', dragId)
                    return
                  }
                  toggleSlot({ kind: 'currency', dragId, currencyType: 'fallen_star' })
                }}
              />
            ) : (
              <InventorySlot
                key={dragId}
                {...commonProps}
                onClick={() => toggleSlot({ kind: 'currency', dragId, currencyType: 'fallen_star' })}
              />
            )

            if (!enableBankDeposit) {
              return (
                <div
                  key={dragId}
                  data-tooltip-action-anchor
                  onClick={(event) => setBundlePopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
                >
                  {fallenStarSlot}
                </div>
              )
            }

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setBankPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {fallenStarSlot}
              </div>
            )
          })}

          {cometScrollTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'scroll' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              iconSrc: COMET_SCROLL_ICON_SRC,
              qualityColor: MATERIAL_COLOR,
              label: 'Comet Scroll',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildCometScrollTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const scrollSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '📜', iconSrc: COMET_SCROLL_ICON_SRC, qualityColor: MATERIAL_COLOR }}
                onDrop={handleTileDrop}
                onClick={(event) => {
                  if (event.shiftKey || tapToPlaceEnabled) {
                    event.stopPropagation()
                    onTileDrop('material', dragId)
                    return
                  }
                  toggleSlot({ kind: 'scroll', dragId, currencyType: 'comet' })
                }}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'scroll', dragId, currencyType: 'comet' })} />
            )

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setScrollPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {scrollSlot}
              </div>
            )
          })}

          {fallenStarScrollTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'scroll' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              iconSrc: FALLEN_STAR_SCROLL_ICON_SRC,
              qualityColor: FALLEN_STAR_COLOR,
              label: 'Fallen Star Scroll',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildFallenStarScrollTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const scrollSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '📜', iconSrc: FALLEN_STAR_SCROLL_ICON_SRC, qualityColor: FALLEN_STAR_COLOR }}
                onDrop={handleTileDrop}
                onClick={(event) => {
                  if (event.shiftKey || tapToPlaceEnabled) {
                    event.stopPropagation()
                    onTileDrop('material', dragId)
                    return
                  }
                  toggleSlot({ kind: 'scroll', dragId, currencyType: 'fallen_star' })
                }}
              />
            ) : (
              <InventorySlot
                key={dragId}
                {...commonProps}
                onClick={() => toggleSlot({ kind: 'scroll', dragId, currencyType: 'fallen_star' })}
              />
            )

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setScrollPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {scrollSlot}
              </div>
            )
          })}

          {cometBoxTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'comet_box' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              iconSrc: COMET_BOX_ICON_SRC,
              qualityColor: MATERIAL_COLOR,
              label: 'Comet Box',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildCometBoxTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const cometBoxSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '🎁', iconSrc: COMET_BOX_ICON_SRC, qualityColor: MATERIAL_COLOR }}
                onDrop={handleTileDrop}
                onClick={() => toggleSlot({ kind: 'comet_box', dragId })}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'comet_box', dragId })} />
            )

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setCometBoxPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {cometBoxSlot}
              </div>
            )
          })}

          {vipTokenTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'vip_token' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '👑',
              iconSrc: VIP_TOKEN_ICON_SRC,
              qualityColor: VIP_TOKEN_COLOR,
              label: 'VIP Token',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildVipTokenTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const vipTokenSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '👑', iconSrc: VIP_TOKEN_ICON_SRC, qualityColor: VIP_TOKEN_COLOR }}
                onDrop={handleTileDrop}
                onClick={() => toggleSlot({ kind: 'vip_token', dragId })}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'vip_token', dragId })} />
            )

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setVipTokenPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {vipTokenSlot}
              </div>
            )
          })}

          {experienceOrbTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'experience_orb' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '🔮',
              iconSrc: EXPERIENCE_ORB_ICON_SRC,
              qualityColor: CONSUMABLE_COLOR,
              label: 'Experience Orb',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildExperienceOrbTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const experienceOrbSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '🔮', iconSrc: EXPERIENCE_ORB_ICON_SRC, qualityColor: CONSUMABLE_COLOR }}
                onDrop={handleTileDrop}
                onClick={() => toggleSlot({ kind: 'experience_orb', dragId })}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'experience_orb', dragId })} />
            )

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setExperienceOrbPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {experienceOrbSlot}
              </div>
            )
          })}

          {experiencePotionTiles.map(({ dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const isSelected = selectedSlot?.kind === 'experience_potion' && selectedSlot.dragId === dragId

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '🧪',
              iconSrc: EXPERIENCE_POTION_ICON_SRC,
              qualityColor: CONSUMABLE_COLOR,
              label: 'Experience Potion',
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : buildExperiencePotionTooltip(),
              selected: isSelected,
              dimmed: dimmedFor(dragId),
            }

            const experiencePotionSlot = onTileDrop ? (
              <DraggableInventorySlot
                key={dragId}
                {...commonProps}
                dragEnabled
                dragPayload={{ id: dragId, icon: '🧪', iconSrc: EXPERIENCE_POTION_ICON_SRC, qualityColor: CONSUMABLE_COLOR }}
                onDrop={handleTileDrop}
                onClick={() => toggleSlot({ kind: 'experience_potion', dragId })}
              />
            ) : (
              <InventorySlot key={dragId} {...commonProps} onClick={() => toggleSlot({ kind: 'experience_potion', dragId })} />
            )

            return (
              <div
                key={dragId}
                data-tooltip-action-anchor
                onClick={(event) => setExperiencePotionPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
              >
                {experiencePotionSlot}
              </div>
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
            const iconSrc = getGearIconSrc(template?.name, item.quality_tier)

            const isSelected = selectedSlot?.kind === 'item' && selectedSlot.id === item.id

            // Money Bag / Gem Bag (Lucky Lad rewards expansion, 2026-08-09) —
            // real item_templates/item_instances rows, but not gear: their own
            // flavor tooltip (Open-for-N-gold / Open-for-a-gem) reads better
            // than buildGearTooltip's level/class/stats framing, which doesn't
            // apply to them.
            const isBagItem = template?.item_family === 'money-bag' || template?.item_family === 'gem-bag'
            const bagTooltip = isBagItem
              ? template?.item_family === 'money-bag'
                ? buildMoneyBagTooltip(template?.name ?? 'Money Bag', template?.price ?? 0)
                : buildGemBagTooltip()
              : null

            const commonProps = {
              slotId: item.id,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              qualityColor,
              icon,
              iconSrc,
              label,
              compositionLevel: item.composition_level,
              broken: itemHasDurability(template?.slot_type) ? (item.durability ?? 0) <= 0 : undefined,
              locked: item.locked,
              // Hover/long-press peek works normally (2026-08-04 fix: "plain
              // mouseover should still show the normal tooltip") except while
              // this exact tile's own popover is open, where it would just
              // duplicate the popover's own tooltip (2026-08-05 fix — see
              // isPopoverOpenForSelection's own comment).
              tooltip: isPopoverOpenForSelection(isSelected) ? undefined : (bagTooltip ?? buildGearTooltip(item, template)),
              // enableCompareToggle-only (Equipment tab, 2026-08-13) — see
              // that prop's own doc comment.
              compareTooltip:
                enableCompareToggle && compareMode && !isBagItem && !isPopoverOpenForSelection(isSelected)
                  ? buildCompareTooltipForItem(template)
                  : null,
              disableTouchPeek: equipPopoverEnabled && enableCompareToggle,
              selected: isSelected,
              dimmed: dimmedFor(item.id),
            }

            // Merged (2026-08-03, was two separate early-return branches) so
            // the popover wrappers below can apply regardless of whether this
            // instance also has onTileDrop wired up (BankPanel's
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
                onClick={(event) => {
                  // Desktop shortcut (2026-08-19) — shift-click drops this
                  // item straight into whatever drop-zone key a real drag
                  // would land in for an "upgrade"-style target (Forge's
                  // Upgrade Slot, Composition/Sockets/Enchantress's item
                  // slot). Every current onTileDrop consumer that cares about
                  // gear listens for 'upgrade' — Marketplace/Salvage use
                  // their own keys ('marketplace-listing'/'salvage') and
                  // simply no-op here, same as they would for an
                  // unrecognized drop target today. tapToPlaceEnabled is the
                  // mobile equivalent (see that prop's own doc comment).
                  if (event.shiftKey || tapToPlaceEnabled) {
                    event.stopPropagation()
                    onTileDrop('upgrade', item.id)
                    return
                  }
                  toggleSlot({ kind: 'item', id: item.id })
                }}
              />
            ) : (
              <InventorySlot key={item.id} {...commonProps} onClick={() => toggleSlot({ kind: 'item', id: item.id })} />
            )

            // Money Bag / Gem Bag "Open" popover — takes precedence over
            // equipPopoverEnabled/enableBankDeposit/enableSelling below,
            // regardless of which InventoryPanel instance this is, since
            // these items are never equippable/bankable/sellable in any
            // meaningful sense — Open is their only real action.
            if (isBagItem) {
              return (
                <div
                  key={item.id}
                  data-tooltip-action-anchor
                  onClick={(event) => setBagPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
                >
                  {slot}
                </div>
              )
            }

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

            return slot
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 p-1 text-lg"
              style={{ borderColor: MATERIAL_COLOR, backgroundColor: `${MATERIAL_COLOR}22` }}
            >
              {getStoneIconSrc(selectedStoneTier) ? (
                <img src={getStoneIconSrc(selectedStoneTier)} alt="" className="h-full w-full object-contain" />
              ) : (
                '🔷'
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">+{selectedStoneTier} Stone</p>
              <p className="text-xs text-slate-300">
                {compositionPointValue(selectedStoneTier)} pts · {stones[String(selectedStoneTier)] ?? 0} owned total
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedGem && !enableBankDeposit && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 p-1 text-lg"
              style={{ borderColor: getGemTierColor(selectedGem.tier), backgroundColor: `${getGemTierColor(selectedGem.tier)}22` }}
            >
              <img src={getGemIconSrc(selectedGem.gemId, selectedGem.tier)} alt="" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {formatGemTierLabel(selectedGem.tier)} {GEM_TYPES[selectedGem.gemId].displayName}
              </p>
              <p className="text-xs text-slate-300">{gemCount(gems, selectedGem.gemId, selectedGem.tier)} owned total</p>
            </div>
          </div>
        </div>
      )}

      {!enableBankDeposit && selectedCurrencyType && bundlePopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bundlePopoverAnchorRect}
          tooltip={selectedCurrencyType === 'comet' ? buildCometTooltip() : buildFallenStarTooltip()}
          actions={[
            {
              label: scrollBusy ? 'Bundling…' : 'Bundle (10 → 1 Scroll)',
              onClick: () => void handleBundle(selectedCurrencyType),
              disabled: (selectedCurrencyType === 'comet' ? comets : fallenStars) < 10 || scrollBusy,
            },
          ]}
          onClose={closeBundlePopover}
        />
      )}

      {selectedScrollType && scrollPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={scrollPopoverAnchorRect}
          tooltip={selectedScrollType === 'comet' ? buildCometScrollTooltip() : buildFallenStarScrollTooltip()}
          actions={[
            {
              label: scrollBusy ? 'Opening…' : 'Open (→ 10 loose)',
              onClick: () => void handleUnbundle(selectedScrollType),
              disabled: scrollBusy,
            },
            // Bank/Bank All (Bank-tab-only, mirrors the loose-unit currency
            // popover's own Bank/Bank All) — banks straight from a Scroll's
            // full value without unbundling into loose Inventory tiles first.
            ...(enableBankDeposit
              ? [
                  {
                    label: scrollBusy ? 'Banking…' : 'Bank',
                    onClick: () => void handleBankScroll(selectedScrollType),
                    disabled: scrollBusy,
                  },
                  {
                    label: 'Bank All',
                    onClick: () => void handleBankAllScroll(selectedScrollType),
                    disabled: scrollBusy,
                  },
                ]
              : []),
          ]}
          onClose={closeScrollPopover}
        />
      )}

      {selectedSlot?.kind === 'comet_box' && cometBoxPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={cometBoxPopoverAnchorRect}
          tooltip={buildCometBoxTooltip()}
          actions={[
            {
              label: cometBoxBusy ? 'Opening…' : `Open (+${COMET_BOX_REWARD_AMOUNT} Bank Comets)`,
              onClick: () => void handleOpenCometBox(),
              disabled: cometBoxBusy,
            },
          ]}
          onClose={closeCometBoxPopover}
        />
      )}

      {selectedSlot?.kind === 'vip_token' && vipTokenPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={vipTokenPopoverAnchorRect}
          tooltip={buildVipTokenTooltip()}
          actions={[
            {
              label: vipTokenBusy ? 'Using…' : `Use (+${VIP_TOKEN_DURATION_DAYS}d VIP)`,
              onClick: () => void handleUseVipToken(),
              disabled: vipTokenBusy,
            },
          ]}
          onClose={closeVipTokenPopover}
        />
      )}

      {selectedSlot?.kind === 'experience_orb' && experienceOrbPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={experienceOrbPopoverAnchorRect}
          tooltip={buildExperienceOrbTooltip()}
          actions={[
            {
              label: experienceOrbBusy ? 'Using…' : 'Use',
              onClick: () => void handleUseExperienceOrb(),
              disabled: experienceOrbBusy,
            },
          ]}
          onClose={closeExperienceOrbPopover}
        />
      )}

      {selectedSlot?.kind === 'experience_potion' && experiencePotionPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={experiencePotionPopoverAnchorRect}
          tooltip={buildExperiencePotionTooltip()}
          actions={[
            {
              label: experiencePotionBusy ? 'Using…' : `Use (2x EXP for ${EXPERIENCE_POTION_DURATION_HOURS}h)`,
              onClick: () => void handleUseExperiencePotion(),
              disabled: experiencePotionBusy,
            },
          ]}
          onClose={closeExperiencePotionPopover}
        />
      )}

      {selectedItem &&
        bagPopoverAnchorRect &&
        (selectedTemplate?.item_family === 'money-bag' || selectedTemplate?.item_family === 'gem-bag') && (
          <TooltipActionPopover
            anchorRect={bagPopoverAnchorRect}
            tooltip={
              selectedTemplate.item_family === 'money-bag'
                ? buildMoneyBagTooltip(selectedTemplate.name, selectedTemplate.price)
                : buildGemBagTooltip()
            }
            actions={[
              {
                label: bagBusy ? 'Opening…' : 'Open',
                onClick: () => void handleOpenBag(selectedItem.id),
                disabled: bagBusy,
              },
              // Money Bag only (not Gem Bag) — sums gold across every Money
              // Bag in the Inventory, any class, into one reveal card.
              ...(selectedTemplate.item_family === 'money-bag'
                ? [
                    {
                      label: bagBusy ? 'Opening…' : 'Open All',
                      onClick: () => void handleOpenAllBags(),
                      disabled: bagBusy,
                    },
                  ]
                : []),
            ]}
            onClose={closeBagPopover}
          />
        )}
      {bagError && <p className="text-xs text-amber-400">{bagError}</p>}

      {selectedPotionStack && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 p-1 text-lg"
              style={{ borderColor: CONSUMABLE_COLOR, backgroundColor: `${CONSUMABLE_COLOR}22` }}
            >
              {POTION_TYPES[selectedPotionStack.potionType].iconSrc ? (
                <img src={POTION_TYPES[selectedPotionStack.potionType].iconSrc} alt="" className="h-full w-full object-contain" />
              ) : POTION_TYPES[selectedPotionStack.potionType].kind === 'hp' ? (
                '🧪'
              ) : (
                '💧'
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{POTION_TYPES[selectedPotionStack.potionType].displayName}</p>
              <p className="text-xs text-slate-300">{POTION_TYPES[selectedPotionStack.potionType].description}</p>
              <p className="text-xs text-slate-300">
                {selectedPotionStack.count} / {POTION_TYPES[selectedPotionStack.potionType].stackSize}
              </p>
            </div>
          </div>

          <PotionUseButton potionType={selectedPotionStack.potionType} onUse={() => void handlePotionUse(selectedPotionStack.id)} />
        </div>
      )}

      {selectedItem &&
        !equipPopoverEnabled &&
        !enableBankDeposit &&
        selectedTemplate?.item_family !== 'money-bag' &&
        selectedTemplate?.item_family !== 'gem-bag' && (() => {
        const selectedMaxDurability = selectedTemplate
          ? computeMaxDurability(selectedTemplate.slot_type, selectedTemplate.required_level)
          : null
        const selectedDurabilityFraction = selectedMaxDurability
          ? Math.min(1, (selectedItem.durability ?? 0) / selectedMaxDurability)
          : 1
        return (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
              style={{ borderColor: getQualityColor(selectedItem.quality_tier) }}
            >
              {getGearIconSrc(selectedTemplate?.name, selectedItem.quality_tier) ? (
                <img src={getGearIconSrc(selectedTemplate?.name, selectedItem.quality_tier)} alt="" className="h-4/5 w-4/5 object-contain" />
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
              <p className="text-xs text-slate-300">{formatItemLevel(selectedItem.level)}</p>
              {selectedTemplate && (
                <p className="text-xs text-slate-300">{formatBaseStats(selectedTemplate.base_stats, selectedItem.quality_tier, selectedTemplate.item_family)}</p>
              )}
              {selectedTemplate && selectedTemplate.required_level > 1 && (
                <p className={meetsLevelRequirement ? 'text-xs text-slate-300' : 'text-xs text-amber-500'}>
                  Requires level {selectedTemplate.required_level}
                </p>
              )}
              {requiredClassLabel && (
                <p className={meetsClassRequirement ? 'text-xs text-slate-300' : 'text-xs text-amber-500'}>
                  {requiredClassLabel} only
                </p>
              )}
            </div>
          </div>

          <Button
            variant="primary"
            disabled={isEquipped(selectedItem.id) || !isEquippableSlot || !meetsLevelRequirement || !meetsClassRequirement}
            title={
              !isEquippableSlot
                ? "This slot isn't wearable yet"
                : !meetsClassRequirement
                  ? `${requiredClassLabel} only`
                  : !meetsLevelRequirement
                    ? `Requires level ${selectedTemplate?.required_level}`
                    : undefined
            }
            onClick={() =>
              selectedTemplate && meetsLevelRequirement && meetsClassRequirement && handleEquip(selectedTemplate, selectedItem)
            }
            className="mt-3 w-full"
          >
            {isEquipped(selectedItem.id)
              ? 'Equipped'
              : !isEquippableSlot
                ? 'Not wearable yet'
                : !meetsClassRequirement
                  ? `${requiredClassLabel} only`
                  : !meetsLevelRequirement
                    ? `Requires level ${selectedTemplate?.required_level}`
                    : 'Equip'}
          </Button>

          {enableSelling && (
            <Button
              variant="primary"
              disabled={isEquipped(selectedItem.id) || sellBusy || selectedItem.locked}
              title={selectedItem.locked ? 'This item is locked — unlock it first.' : undefined}
              onClick={() => void handleSell(selectedItem)}
              className="mt-2 w-full"
            >
              {selectedItem.locked
                ? 'Locked'
                : sellBusy
                  ? 'Selling…'
                  : `Sell (${previewSellPrice(selectedTemplate?.price ?? 0, selectedItem.quality_tier, selectedDurabilityFraction)} gold)`}
            </Button>
          )}
          {sellError && <p className="mt-2 text-xs text-amber-400">{sellError}</p>}
        </div>
        )
      })()}

      {equipPopoverEnabled && selectedItem && popoverAnchorRect && (
        <GearEquipPopover
          anchorRect={popoverAnchorRect}
          tooltip={buildGearTooltip(selectedItem, selectedTemplate)}
          compareTooltip={compareTooltip}
          alreadyEquipped={isEquipped(selectedItem.id)}
          canEquip={!isEquipped(selectedItem.id) && isEquippableSlot && meetsLevelRequirement && meetsClassRequirement}
          equipLabel={
            isEquipped(selectedItem.id)
              ? 'Equipped'
              : !isEquippableSlot
                ? 'Not wearable yet'
                : !meetsClassRequirement
                  ? `${requiredClassLabel} only`
                  : !meetsLevelRequirement
                    ? `Requires level ${selectedTemplate?.required_level}`
                    : 'Equip'
          }
          onEquip={() => {
            if (selectedTemplate && meetsLevelRequirement && meetsClassRequirement) {
              handleEquip(selectedTemplate, selectedItem)
            }
          }}
          onClose={closeGearPopover}
          autoCompare={enableCompareToggle && compareMode}
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
            {
              label: 'Deposit All',
              onClick: () => void handleBankDepositAllGear(),
              disabled: bankDepositBusy,
            },
            // Bank (liquidate composition into gear_composition_points) only
            // makes sense once the item actually has a composition level —
            // a still-Normal item is rejected server-side as worthless, so
            // it's hidden here rather than shown-then-erroring. Also hidden
            // for a locked item (requested by the user) — deposit_item_as_composition
            // refuses it server-side anyway, but this avoids offering a
            // button that would just error.
            ...(selectedItem.composition_level > 0 && !selectedItem.locked
              ? [
                  {
                    label: bankDepositBusy ? 'Banking…' : 'Bank',
                    onClick: () => void handleBankGear(selectedItem.id),
                    disabled: bankDepositBusy,
                  },
                  {
                    label: 'Bank All',
                    onClick: () => void handleBankAllGear(),
                    disabled: bankDepositBusy,
                  },
                ]
              : []),
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
              label: bankDepositBusy ? 'Banking…' : 'Bank',
              onClick: () => void handleBankStone(selectedStoneTier),
              disabled: bankDepositBusy,
            },
            {
              label: 'Bank All',
              onClick: () => void handleBankAllStone(selectedStoneTier),
              disabled: bankDepositBusy,
            },
          ]}
          onClose={closeBankPopover}
        />
      )}

      {enableBankDeposit && selectedGem && bankPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankPopoverAnchorRect}
          tooltip={buildGemTooltip(selectedGem.gemId, selectedGem.tier)}
          actions={[
            {
              label: bankDepositBusy ? 'Banking…' : 'Bank',
              onClick: () => void handleBankGem(selectedGem.gemId, selectedGem.tier),
              disabled: bankDepositBusy,
            },
            {
              label: 'Bank All',
              onClick: () => void handleBankAllGem(selectedGem.gemId, selectedGem.tier),
              disabled: bankDepositBusy,
            },
          ]}
          onClose={closeBankPopover}
        />
      )}

      {enableBankDeposit && selectedCurrencyType && bankPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankPopoverAnchorRect}
          tooltip={selectedCurrencyType === 'comet' ? buildCometTooltip() : buildFallenStarTooltip()}
          actions={[
            {
              label: scrollBusy ? 'Bundling…' : 'Bundle (10 → 1 Scroll)',
              onClick: () => void handleBundle(selectedCurrencyType),
              disabled: (selectedCurrencyType === 'comet' ? comets : fallenStars) < 10 || scrollBusy,
            },
            {
              label: bankDepositBusy ? 'Banking…' : 'Bank',
              onClick: () => void handleBankCurrency(selectedCurrencyType),
              disabled: bankDepositBusy,
            },
            {
              label: 'Bank All',
              onClick: () => void handleBankAllCurrency(selectedCurrencyType),
              disabled: bankDepositBusy,
            },
          ]}
          onClose={closeBankPopover}
        />
      )}
    </div>
  )
}
