import { useCharacterStore } from '../stats/useCharacterStore'
import { useVipAutomationStore } from './useVipAutomationStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { useEquipmentStore } from '../items/useEquipmentStore'
import { useMarketplaceStore } from '../marketplace/useMarketplaceStore'
import { useMailStore } from '../marketplace/useMailStore'
import { useBankStore } from '../items/useBankStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { QUALITY_ORDER } from '../items/equipmentBonus'
import { emptyVipAutomationSummary, type VipAutomationSummary } from './vipAutomationSummary'

let passInFlight = false

function isVipActiveNow(): boolean {
  const vipExpiresAt = useCharacterStore.getState().vipExpiresAt
  return Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
}

// The one real entry point for every VIP auto-liquidation rule — called
// reactively (VipAutomationEngine, live play) and synchronously right after
// both offline-catch-up flows (offlineProgress.ts/offlineMiningProgress.ts),
// so the welcome-back modal has a summary ready before it renders.
//
// Handles both real Inventory items AND Loot Holding entries. Offline
// catch-up routes drops into Loot Holding, not straight into Inventory (see
// CLAUDE.combat-and-loot.md's Loot section) — missing that was a real bug
// (reported by the user): Ore sat unsold in "Unclaimed rewards" after an AFK
// mining session because the original version of this only ever looked at
// useInventoryStore.items.
export async function runVipAutomationPass(): Promise<VipAutomationSummary> {
  const summary = emptyVipAutomationSummary()

  if (passInFlight || !isVipActiveNow()) {
    return summary
  }

  const settings = useVipAutomationStore.getState().settings
  if (!settings.autoSellOre && !settings.autoSalvage.enabled && !settings.autoBank.enabled) {
    return summary
  }

  passInFlight = true

  try {
    const templates = useItemTemplatesStore.getState().templates
    const templateById = new Map(templates.map((template) => [template.id, template]))
    const isEquipped = useEquipmentStore.getState().isEquipped
    const myListings = useMarketplaceStore.getState().myListings
    const isListed = (itemId: string) => myListings.some((listing) => listing.status === 'active' && listing.item_id === itemId)
    const mailEntries = useMailStore.getState().entries
    const hasUnclaimedMail = (itemId: string) => mailEntries.some((entry) => entry.item_id === itemId && entry.claimed_at === null)
    const salvageMinRank = QUALITY_ORDER.indexOf(settings.autoSalvage.minTier)

    const qualifiesSalvage = (qualityTier: string) =>
      settings.autoSalvage.enabled && salvageMinRank >= 0 && QUALITY_ORDER.indexOf(qualityTier) >= salvageMinRank
    const qualifiesBank = (compositionLevel: number) => settings.autoBank.enabled && compositionLevel >= settings.autoBank.minLevel

    const salvageItemAndTally = async (itemId: string) => {
      const result = await useInventoryStore.getState().salvageItem(itemId)
      if (result.ok) {
        summary.itemsSalvagedCount += 1
        summary.apGained += result.apGained ?? 0
      }
    }
    const bankItemAndTally = async (itemId: string) => {
      const result = await useBankStore.getState().depositItemAsComposition(itemId)
      if (result.ok) {
        summary.itemsBankedCount += 1
        summary.compositionPointsGained += result.points_gained ?? 0
      }
    }

    // 1. Real Inventory items (live play, or anything already claimed).
    const inventoryItems = useInventoryStore.getState().items
    const eligibleInventoryItems = inventoryItems.filter(
      (item) => item.location !== 'bank' && !item.locked && !isEquipped(item.id) && !isListed(item.id) && !hasUnclaimedMail(item.id),
    )

    if (settings.autoSellOre) {
      const oreItemIds = eligibleInventoryItems
        .filter((item) => templateById.get(item.template_id)?.item_family === 'ore')
        .map((item) => item.id)
      const sellResults = await Promise.all(oreItemIds.map((itemId) => useInventoryStore.getState().sellItem(itemId)))
      for (const result of sellResults) {
        if (result.ok) {
          summary.oreSoldCount += 1
          summary.goldGained += result.goldGained ?? 0
        }
      }
    }

    const toSalvage: string[] = []
    const toBank: string[] = []
    for (const item of eligibleInventoryItems) {
      if (!templateById.has(item.template_id)) {
        continue
      }
      const salvageOk = qualifiesSalvage(item.quality_tier)
      const bankOk = qualifiesBank(item.composition_level)
      if (salvageOk && bankOk) {
        ;(settings.priority === 'salvage_first' ? toSalvage : toBank).push(item.id)
      } else if (salvageOk) {
        toSalvage.push(item.id)
      } else if (bankOk) {
        toBank.push(item.id)
      }
    }
    await Promise.all([...toSalvage.map(salvageItemAndTally), ...toBank.map(bankItemAndTally)])

    // 2. Loot Holding entries. Ore is sold directly out of holding via
    // sell_loot_holding — no need to claim it into Inventory first. Currency
    // entries (Comet/Fallen Star, template_id null) are skipped entirely,
    // out of scope for every rule here.
    const holdingEntries = useLootHoldingStore.getState().entries.filter((entry) => entry.template_id !== null)

    if (settings.autoSellOre) {
      const oreEntryIds = holdingEntries
        .filter((entry) => templateById.get(entry.template_id!)?.item_family === 'ore')
        .map((entry) => entry.id)
      const sellResults = await Promise.all(oreEntryIds.map((holdingId) => useLootHoldingStore.getState().sell(holdingId)))
      for (const result of sellResults) {
        if (result.ok) {
          summary.oreSoldCount += 1
          summary.goldGained += result.gold_gained ?? 0
        }
      }
    }

    // Quality/+N gear needs a real item_instances row to salvage/bank, so
    // claim first. Sequential, not Promise.all — claim_loot_holding has no
    // server-side room check (client pre-check only, see LootHoldingCard's
    // own claimEntriesUpToRoom), so batching claims in parallel could
    // over-claim past the Inventory cap before any of them get re-liquidated
    // in the same pass.
    const nonOreHoldingEntries = holdingEntries.filter((entry) => templateById.get(entry.template_id!)?.item_family !== 'ore')
    for (const entry of nonOreHoldingEntries) {
      const salvageOk = qualifiesSalvage(entry.quality_tier ?? 'normal')
      const bankOk = qualifiesBank(entry.composition_level)
      if (!salvageOk && !bankOk) {
        continue
      }

      const claimResult = await useLootHoldingStore.getState().claim(entry.id)
      if (!claimResult.ok || !claimResult.item) {
        continue
      }

      if (salvageOk && bankOk) {
        await (settings.priority === 'salvage_first' ? salvageItemAndTally(claimResult.item.id) : bankItemAndTally(claimResult.item.id))
      } else if (salvageOk) {
        await salvageItemAndTally(claimResult.item.id)
      } else {
        await bankItemAndTally(claimResult.item.id)
      }
    }

    return summary
  } finally {
    passInFlight = false
  }
}
