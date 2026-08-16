import { useState } from 'react'
import CompositionLoadBar from './CompositionLoadBar'
import EquippedGearPicker from './EquippedGearPicker'
import ForgeCompositionPanel from './ForgeCompositionPanel'
import ForgeMaterialSlot, { MAX_MATERIAL_ENTRIES, type MaterialEntry } from './ForgeMaterialSlot'
import ForgeTwoColumnLayout from './ForgeTwoColumnLayout'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import { DragDropProvider } from './dragDrop'
import InventoryPanel from './InventoryPanel'
import { compositionPointValue, isFallenStarDragId, isCometDragId, parseStoneDragId, simulateCompositionFeed } from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

function describeFeedFailure(error?: string): string {
  switch (error) {
    case 'not_enough_stones':
      return "You don't have that many of one of those stones."
    case 'fuel_not_owned':
      return "One of those fuel items couldn't be found."
    case 'fuel_is_target_item':
      return "An item can't be fed into itself."
    case 'no_points_contributed':
      return 'Place at least one stone or item in the Fuel slot.'
    case 'already_max_composition':
      return 'This item is already at maximum composition.'
    case 'not_owner':
    case 'item_not_found':
      return "Couldn't find that item."
    default:
      return 'Something went wrong.'
  }
}

interface ForgeCompositionTabProps {
  onBack: () => void
}

// Composition (2026-08-13 redesign — split out of the old Forge tile's own
// drag-detection into its own tile/panel). Drag up to 2 stones and/or gear
// items into the Fuel slot, see the live "after feed" preview, and commit —
// no RNG, always fully applies (see CLAUDE.md's Composition section).
export default function ForgeCompositionTab({ onBack }: ForgeCompositionTabProps) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const busy = useForgeStore((state) => state.busy)
  const compositionFeed = useForgeStore((state) => state.compositionFeed)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([])
  const [feedError, setFeedError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  const stoneAmounts = materialEntries.reduce<Record<string, number>>((amounts, entry) => {
    if (entry.kind === 'stone') {
      amounts[String(entry.tier)] = (amounts[String(entry.tier)] ?? 0) + 1
    }
    return amounts
  }, {})
  const fuelItemIds = materialEntries.flatMap((entry) => (entry.kind === 'item' ? [entry.id] : []))

  const compositionAddedPoints = materialEntries.reduce((sum, entry) => {
    if (entry.kind === 'stone') {
      return sum + compositionPointValue(entry.tier)
    }
    if (entry.kind === 'item') {
      return sum + compositionPointValue(entry.item.composition_level)
    }
    return sum
  }, 0)
  const compositionPreview =
    selectedItem && compositionAddedPoints > 0
      ? simulateCompositionFeed(selectedItem.composition_level, selectedItem.composition_points, compositionAddedPoints)
      : null

  const handleDropItemId = (itemId: string) => {
    if (!items.some((item) => item.id === itemId) || materialEntries.some((entry) => entry.id === itemId)) {
      return
    }

    setSelectedItemId(itemId)
    setMaterialEntries([])
    setFeedError(null)
  }

  const handleRemove = () => {
    setSelectedItemId(null)
    setMaterialEntries([])
    setFeedError(null)
  }

  const handleDropMaterial = (id: string) => {
    // Composition doesn't take Comets/Fallen Stars — those belong to the
    // Forge tile's own Quality/Level path.
    if (!selectedItem || id === selectedItemId || materialEntries.some((entry) => entry.id === id) || isCometDragId(id) || isFallenStarDragId(id)) {
      return
    }

    const stoneTier = parseStoneDragId(id)
    if (stoneTier !== null) {
      setMaterialEntries((current) => (current.length >= MAX_MATERIAL_ENTRIES ? current : [...current, { kind: 'stone', id, tier: stoneTier }]))
      setFeedError(null)
      return
    }

    const item = items.find((entry) => entry.id === id)
    if (!item) {
      return
    }

    setMaterialEntries((current) => (current.length >= MAX_MATERIAL_ENTRIES ? current : [...current, { kind: 'item', id, item }]))
    setFeedError(null)
  }

  const handleRemoveMaterial = (id: string) => {
    setMaterialEntries((current) => current.filter((entry) => entry.id !== id))
    setFeedError(null)
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleDropItemId(id)
      return
    }

    if (overTarget === 'material') {
      handleDropMaterial(id)
    }
  }

  const handleFeed = async () => {
    if (!selectedItem) {
      return
    }

    // Minimum 1s so the white "staged" bar always gets a full second to ease
    // into amber (CompositionLoadBar) before collapsing into committed
    // progress, even if the RPC itself resolves faster than that.
    setConfirming(true)
    const [result] = await Promise.all([compositionFeed(selectedItem.id, stoneAmounts, fuelItemIds), new Promise((resolve) => setTimeout(resolve, 1000))])
    setConfirming(false)

    if (!result.ok) {
      setFeedError(describeFeedFailure(result.error))
      return
    }

    setMaterialEntries([])
    setFeedError(null)
  }

  return (
    <DragDropProvider>
      <ForgeTwoColumnLayout
        title="Composition"
        onBack={onBack}
        inventory={
          <InventoryPanel
            columns={5}
            reservedItemIds={[...(selectedItemId ? [selectedItemId] : []), ...materialEntries.map((entry) => entry.id)]}
            onTileDrop={handleTileDrop}
          />
        }
      >
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-start justify-center gap-6">
            <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemove} />
            <ForgeMaterialSlot entries={materialEntries} templates={templates} onRemoveEntry={handleRemoveMaterial} />
          </div>

          {selectedItem && (
            <CompositionLoadBar item={selectedItem} addedPoints={compositionAddedPoints} preview={compositionPreview} confirming={confirming} />
          )}
        </div>

        {!selectedItem && <EquippedGearPicker onSelect={handleDropItemId} />}

        <div className="w-full max-w-xs space-y-2">
          {!selectedItem ? (
            <p className="text-center text-[11px] text-slate-600">Drag an item into the Upgrade Slot, or tap one you have equipped.</p>
          ) : (
            <ForgeCompositionPanel
              item={selectedItem}
              template={selectedTemplate}
              entries={materialEntries}
              busy={busy}
              onFeed={() => void handleFeed()}
              feedError={feedError}
            />
          )}
        </div>
      </ForgeTwoColumnLayout>
    </DragDropProvider>
  )
}
