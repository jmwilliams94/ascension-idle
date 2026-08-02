import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { LOOT_HOLDING_CAP, useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { formatItemDisplayName, getItemIcon, getQualityColor, previewSellPrice } from '../game/items/equipmentBonus'
import { DRAGONBALL_COLOR, DRAGONBALL_ICON_SRC, MATERIAL_COLOR, METEOR_ICON_SRC } from '../game/items/forgeCosts'

// Loot Holding (confirmed with the user, 2026-07-30): where a server-resolved
// kill's item drop lands when Inventory is full — see useLootHoldingStore and
// supabase/functions/resolve-combat. Lives exclusively inside
// OfflineProgressModal (2026-07-31) — Loot Holding's only remaining source is
// the offline/idle-progress simulator; live play stops the fight outright on
// a full Inventory instead (see useCombatStore.stopForInventoryFull).
//
// Simplified (2026-08-03, per the user's request): this card used to have its
// own click-to-select detail card, a checkbox multi-select + bulk action bar,
// a "Claim All" button, and a "Select individually…" toggle. All of that is
// gone — the only remaining action here is "Sell All Normal" (unloading
// Normal-tier junk for gold before claiming the rest). Claiming everything
// that's left is now the modal's own "Claim" button (see
// OfflineProgressModal.tsx), not a separate control in here — "since they
// will all be claimed after selling anyway," per the user's own reasoning,
// there's no need for granular per-item claim/select. The grid below is
// purely a visual preview of what's pending now, not interactive.
//
// Grid width bug fix (2026-08-03): this was hardcoded to 8 columns, wider
// than a phone viewport even at the smaller mobile tile size — the same
// overflow bug already fixed elsewhere (InventoryPanel, WarehouseGrid,
// Forge/Bank's own InventoryPanel usages), just never caught here since it
// only ever renders inside this one modal. Now 5, matching that established
// convention, and centered like every other grid that got the same fix.
export default function LootHoldingCard() {
  const entries = useLootHoldingStore((state) => state.entries)
  const busy = useLootHoldingStore((state) => state.busy)
  const sell = useLootHoldingStore((state) => state.sell)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [error, setError] = useState<string | null>(null)

  if (entries.length === 0) {
    return null
  }

  const normalEntries = entries.filter((entry) => entry.template_id && entry.quality_tier === 'normal')
  const normalSellTotal = normalEntries.reduce((sum, entry) => {
    const template = templates.find((t) => t.id === entry.template_id)
    return sum + (template ? previewSellPrice(template.price, 'normal') : 0)
  }, 0)

  const handleSellAllNormal = async () => {
    setError(null)
    // Parallel, not sequential (2026-08-01, fixes a visible "sells one at a
    // time" delay) — each sell call is an independent row delete, same
    // reasoning as InventoryPanel's own bulk sell.
    const results = await Promise.all(normalEntries.map((entry) => sell(entry.id)))
    const failures = results.filter((result) => !result.ok).length
    if (failures > 0) {
      setError(`Couldn't sell ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎁</span>
          <div>
            <p className="text-sm font-semibold text-slate-200">Loot Holding</p>
            <p className="text-[11px] text-slate-500">
              {entries.length}/{LOOT_HOLDING_CAP} pending
            </p>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Drops that couldn't fit while you were away land here — sell off Normal-tier junk now if you want, then Claim below to
        bring the rest into your Inventory.
      </p>

      {normalEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSellAllNormal()}
            className="rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sell All Normal ({normalSellTotal.toLocaleString()} gold)
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-amber-400">{error}</p>}

      <div className="flex justify-center overflow-x-auto">
        <div className="grid grid-cols-[repeat(5,3.5rem)] gap-1.5 lg:grid-cols-[repeat(5,4rem)]">
          {entries.map((entry) => {
            const isCurrency = Boolean(entry.currency_type)
            const template = entry.template_id ? templates.find((t) => t.id === entry.template_id) : null
            const label = isCurrency
              ? entry.currency_type === 'meteor'
                ? 'Meteor'
                : 'DragonBall'
              : template && entry.quality_tier
                ? formatItemDisplayName(template.name, entry.quality_tier)
                : 'Unknown item'
            const icon = isCurrency ? undefined : getItemIcon(template?.slot_type)
            const iconSrc = isCurrency ? (entry.currency_type === 'meteor' ? METEOR_ICON_SRC : DRAGONBALL_ICON_SRC) : undefined

            return (
              <InventorySlot
                key={entry.id}
                slotId={entry.id}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon={icon}
                iconSrc={iconSrc}
                label={label}
                qualityColor={
                  isCurrency
                    ? entry.currency_type === 'meteor'
                      ? MATERIAL_COLOR
                      : DRAGONBALL_COLOR
                    : getQualityColor(entry.quality_tier ?? 'normal')
                }
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
