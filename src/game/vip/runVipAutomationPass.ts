import { useCharacterStore } from '../stats/useCharacterStore'
import { useVipAutomationStore } from './useVipAutomationStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { useEquipmentStore, EQUIP_SLOTS, type EquipSlot } from '../items/useEquipmentStore'
import { useMarketplaceStore } from '../marketplace/useMarketplaceStore'
import { useMailStore } from '../marketplace/useMailStore'
import { useBankStore } from '../items/useBankStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { isDropSourced } from '../items/dropSourceTracking'
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
  if (!settings.autoSellOre && !settings.autoSellGear && !settings.autoSalvage.enabled && !settings.autoBank.enabled) {
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

    // Never auto-salvage a socketed item (sockets are a deliberate player
    // investment, same reasoning SalvagePanel's own bulk-salvage sweep
    // already applies) or anything above +1 composition (a hard cap, not
    // tied to settings.autoBank.minLevel — a +2 piece must never be
    // salvaged by automation even if Auto-Bank is disabled or its threshold
    // is set above +2).
    const qualifiesSalvage = (item: { quality_tier: string; composition_level: number; sockets?: unknown[] }) =>
      settings.autoSalvage.enabled &&
      salvageMinRank >= 0 &&
      QUALITY_ORDER.indexOf(item.quality_tier) >= salvageMinRank &&
      item.composition_level <= 1 &&
      (item.sockets?.length ?? 0) === 0
    const qualifiesBank = (compositionLevel: number) => settings.autoBank.enabled && compositionLevel >= settings.autoBank.minLevel
    // Normal-quality gear only (0 AP means it can never qualify for Salvage —
    // see qualifiesSalvage above) and only real equip-slot gear, never Ore
    // (also always quality_tier 'normal', but that's autoSellOre's own
    // territory) or materials/consumables that happen to default to 'normal'.
    // Composed Normal gear (composition_level > 0) still prefers Auto-Bank
    // over a flat gold sale when both are enabled.
    const qualifiesSellGear = (item: { quality_tier: string; composition_level: number; template_id: string }) => {
      if (!settings.autoSellGear || item.quality_tier !== 'normal' || qualifiesBank(item.composition_level)) {
        return false
      }
      const slotType = templateById.get(item.template_id)?.slot_type
      return EQUIP_SLOTS.includes(slotType as EquipSlot)
    }

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
    const sellGearItemAndTally = async (itemId: string) => {
      const result = await useInventoryStore.getState().sellItem(itemId)
      if (result.ok) {
        summary.itemsSoldCount += 1
        summary.gearGoldGained += result.goldGained ?? 0
      }
    }

    // 1. Real Inventory items (live play, or anything already claimed).
    // isDropSourced restricts this to items that actually came from a
    // combat/mining drop (or a Loot Holding claim of one) — VIP automation
    // must never touch an item the player brought into Inventory themselves
    // (Bank withdraw, Mail claim, Marketplace, Lucky Lad, achievement/
    // Promotion rewards). Reported bug: withdrawing from Bank Storage got the
    // withdrawn item auto-salvaged within the same second. See
    // dropSourceTracking.ts.
    const inventoryItems = useInventoryStore.getState().items
    const eligibleInventoryItems = inventoryItems.filter(
      (item) =>
        item.location !== 'bank' &&
        !item.locked &&
        !isEquipped(item.id) &&
        !isListed(item.id) &&
        !hasUnclaimedMail(item.id) &&
        isDropSourced(item.id),
    )

    if (settings.autoSellOre) {
      const oreItemIds = eligibleInventoryItems
        .filter((item) => templateById.get(item.template_id)?.item_family === 'ore')
        .map((item) => item.id)
      const sellResults = await Promise.all(oreItemIds.map((itemId) => useInventoryStore.getState().sellItem(itemId)))
      for (const result of sellResults) {
        if (result.ok) {
          summary.oreSoldCount += 1
          summary.oreGoldGained += result.goldGained ?? 0
        }
      }
    }

    const toSalvage: string[] = []
    const toBank: string[] = []
    const toSellGear: string[] = []
    for (const item of eligibleInventoryItems) {
      if (!templateById.has(item.template_id)) {
        continue
      }
      const salvageOk = qualifiesSalvage(item)
      const bankOk = qualifiesBank(item.composition_level)
      if (salvageOk && bankOk) {
        ;(settings.priority === 'salvage_first' ? toSalvage : toBank).push(item.id)
      } else if (salvageOk) {
        toSalvage.push(item.id)
      } else if (bankOk) {
        toBank.push(item.id)
      } else if (qualifiesSellGear(item)) {
        toSellGear.push(item.id)
      }
    }
    await Promise.all([...toSalvage.map(salvageItemAndTally), ...toBank.map(bankItemAndTally), ...toSellGear.map(sellGearItemAndTally)])

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
          summary.oreGoldGained += result.gold_gained ?? 0
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
      const qualityTier = entry.quality_tier ?? 'normal'
      // Loot Holding entries are unclaimed drops — never pre-socketed
      // (socket unlock is a Forge action on a claimed item_instances row),
      // so no sockets field to check here.
      const salvageOk = qualifiesSalvage({ quality_tier: qualityTier, composition_level: entry.composition_level })
      const bankOk = qualifiesBank(entry.composition_level)

      if (!salvageOk && !bankOk) {
        // Normal-tier gear sells straight out of holding, same as Ore —
        // no need to claim into Inventory first just to sell it right back out.
        if (qualifiesSellGear({ quality_tier: qualityTier, composition_level: entry.composition_level, template_id: entry.template_id! })) {
          const result = await useLootHoldingStore.getState().sell(entry.id)
          if (result.ok) {
            summary.itemsSoldCount += 1
            summary.gearGoldGained += result.gold_gained ?? 0
          }
        }
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
