import { useEffect } from 'react'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useVipAutomationStore } from './useVipAutomationStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { useEquipmentStore } from '../items/useEquipmentStore'
import { useMarketplaceStore } from '../marketplace/useMarketplaceStore'
import { useMailStore } from '../marketplace/useMailStore'
import { useBankStore } from '../items/useBankStore'
import { QUALITY_ORDER } from '../items/equipmentBonus'

// Debounces a burst of Inventory changes (e.g. every item landing from one
// ~4s resolve tick) into a single automation pass instead of one per item.
const PASS_DEBOUNCE_MS = 800

// Module-scope, not component state — this engine is a singleton (one
// instance mounted unconditionally in GameShell), so a plain flag is enough
// to stop overlapping passes without needing a ref threaded into the
// module-level runAutomationPass function below.
let passRunning = false

// Non-visual, mounted unconditionally in GameShell (same shape as
// CombatEngine/MiningEngine) — reacts to Inventory changes while VIP is
// active and liquidates eligible items per the player's own VipSettingsModal
// configuration. Deliberately live-tab-open only (confirmed with the user) —
// no offline/Edge-Function coverage, since this project has no cron and that
// would require mirroring changes into both resolve-combat and
// resolve-mining. All actions below replay existing single-item RPCs
// (sell_item/salvage_item/deposit_item_as_composition) every player can
// already invoke manually from Shop/Salvage/Bank — VIP only adds the
// repetition, not new access.
export default function VipAutomationEngine() {
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const settings = useVipAutomationStore((state) => state.settings)
  const items = useInventoryStore((state) => state.items)

  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
  const settingsKey = JSON.stringify(settings)

  useEffect(() => {
    if (!isVipActive) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      void runAutomationPass()
    }, PASS_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
    // items/settingsKey intentionally drive re-scheduling; the pass itself
    // always reads fresh state off the stores rather than closed-over props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVipActive, settingsKey, items])

  return null
}

async function runAutomationPass() {
  if (passRunning) {
    return
  }
  passRunning = true

  try {
    const settings = useVipAutomationStore.getState().settings
    const currentItems = useInventoryStore.getState().items
    const templates = useItemTemplatesStore.getState().templates
    const isEquipped = useEquipmentStore.getState().isEquipped
    const myListings = useMarketplaceStore.getState().myListings
    const isListed = (itemId: string) => myListings.some((listing) => listing.status === 'active' && listing.item_id === itemId)
    const mailEntries = useMailStore.getState().entries
    const hasUnclaimedMail = (itemId: string) => mailEntries.some((entry) => entry.item_id === itemId && entry.claimed_at === null)

    // Same "visibleItems" shape InventoryPanel/SalvagePanel each reimplement
    // locally — plus excluding locked items, the player's own free way to
    // protect a specific item from every rule below.
    const eligibleItems = currentItems.filter(
      (item) => item.location !== 'bank' && !item.locked && !isEquipped(item.id) && !isListed(item.id) && !hasUnclaimedMail(item.id),
    )
    const templateById = new Map(templates.map((template) => [template.id, template]))

    if (settings.autoSellOre) {
      const oreItemIds = eligibleItems.filter((item) => templateById.get(item.template_id)?.item_family === 'ore').map((item) => item.id)
      await Promise.all(oreItemIds.map((itemId) => useInventoryStore.getState().sellItem(itemId)))
    }

    const salvageMinRank = QUALITY_ORDER.indexOf(settings.autoSalvage.minTier)
    const toSalvage: string[] = []
    const toBank: string[] = []

    for (const item of eligibleItems) {
      if (!templateById.has(item.template_id)) {
        continue
      }

      const qualifiesSalvage = settings.autoSalvage.enabled && salvageMinRank >= 0 && QUALITY_ORDER.indexOf(item.quality_tier) >= salvageMinRank
      const qualifiesBank = settings.autoBank.enabled && item.composition_level >= settings.autoBank.minLevel

      if (qualifiesSalvage && qualifiesBank) {
        ;(settings.priority === 'salvage_first' ? toSalvage : toBank).push(item.id)
      } else if (qualifiesSalvage) {
        toSalvage.push(item.id)
      } else if (qualifiesBank) {
        toBank.push(item.id)
      }
    }

    await Promise.all([
      ...toSalvage.map((itemId) => useInventoryStore.getState().salvageItem(itemId)),
      ...toBank.map((itemId) => useBankStore.getState().depositItemAsComposition(itemId)),
    ])
  } finally {
    passRunning = false
  }
}
