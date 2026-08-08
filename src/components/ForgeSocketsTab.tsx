import { useState } from 'react'
import ForgeSocketSlot from './ForgeSocketSlot'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import InventoryPanel from './InventoryPanel'
import { DragDropProvider } from './dragDrop'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useForgeStore } from '../game/items/useForgeStore'
import { effectiveCurrencyAvailable } from '../game/items/forgeCosts'
import { parseGemDragId } from '../game/items/gemTypes'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

const MAX_SOCKETS = 2
const ARMOR_SLOT_TYPES = ['ring', 'necklace', 'boots', 'hat', 'coat']

function describeUnlockFailure(error?: string): string {
  switch (error) {
    case 'not_enough_fallen_stars':
      return 'Not enough Fallen Stars.'
    case 'not_enough_room_to_unbundle':
      return "Would need to unbundle a Scroll for this, but there's no Inventory room for it."
    case 'max_sockets':
      return 'Already has the max 2 sockets.'
    case 'not_a_weapon':
      return "This item can't take a purchased socket."
    default:
      return 'Something went wrong.'
  }
}

function describeSocketFailure(error?: string): string {
  switch (error) {
    case 'socket_not_unlocked':
      return "That socket isn't unlocked yet."
    case 'not_enough_gems':
      return "You don't have that gem anymore."
    default:
      return "Couldn't socket that gem."
  }
}

// Sockets tab (2026-08-10, replaces the old collapsible "Sockets" toggle that
// lived inside Standard Forge mode, plus the informational-only
// ForgeSocketsPanel it showed — see CLAUDE.md's Sockets section). A real,
// standalone drag-and-drop flow now that gems are actual Inventory items:
// drag a gear item with sockets into the Upgrade Slot (reused as-is), then
// drag a gem tile from the grid below onto one of its (unlocked) socket
// slots. A filled socket stays a live drop target — it can be overwritten
// with a different gem — but there's deliberately no way to empty one again,
// per the user's explicit "gems can never be removed."
export default function ForgeSocketsTab() {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const fallenStarScrolls = useCurrencyStore((state) => state.fallenStarScrolls)
  const busy = useForgeStore((state) => state.busy)
  const unlockWeaponSocket = useForgeStore((state) => state.unlockWeaponSocket)
  const socketGem = useForgeStore((state) => state.socketGem)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [socketError, setSocketError] = useState<string | null>(null)

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  const socketCount = selectedItem?.sockets.length ?? 0
  const isWeapon = selectedTemplate?.slot_type === 'weapon'
  const isArmor = selectedTemplate ? ARMOR_SLOT_TYPES.includes(selectedTemplate.slot_type) : false
  const maxed = socketCount >= MAX_SOCKETS
  const unlockCost = socketCount === 0 ? 1 : 5

  const handleRemoveItem = () => {
    setSelectedItemId(null)
    setUnlockError(null)
    setSocketError(null)
  }

  const handleDropItemId = (itemId: string) => {
    if (!items.some((item) => item.id === itemId)) {
      return
    }
    setSelectedItemId(itemId)
    setUnlockError(null)
    setSocketError(null)
  }

  const handleUnlock = async () => {
    if (!selectedItem) {
      return
    }
    setUnlockError(null)
    const result = await unlockWeaponSocket(selectedItem.id)
    if (!result.ok) {
      setUnlockError(describeUnlockFailure(result.error))
    }
  }

  const handleDropGem = async (socketIndex: number, id: string) => {
    if (!selectedItem || socketIndex >= socketCount) {
      return
    }
    const parsed = parseGemDragId(id)
    if (!parsed) {
      return
    }
    setSocketError(null)
    const result = await socketGem(selectedItem.id, socketIndex, parsed.gemId, parsed.tier)
    if (!result.ok) {
      setSocketError(describeSocketFailure(result.error))
    }
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleDropItemId(id)
      return
    }
    if (overTarget === 'socket-0') {
      void handleDropGem(0, id)
      return
    }
    if (overTarget === 'socket-1') {
      void handleDropGem(1, id)
    }
  }

  return (
    <DragDropProvider>
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-start justify-center gap-6">
            <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemoveItem} />
            <ForgeSocketSlot index={0} unlocked={socketCount >= 1} filledKey={selectedItem?.sockets[0] ?? null} />
            <ForgeSocketSlot index={1} unlocked={socketCount >= 2} filledKey={selectedItem?.sockets[1] ?? null} />
          </div>

          <div className="w-full max-w-xs space-y-2">
            {!selectedItem ? (
              <p className="text-center text-[11px] text-slate-600">Drag an item into the slot on the left.</p>
            ) : isWeapon ? (
              maxed ? (
                <p className="text-center text-[10px] text-slate-500">Both sockets unlocked.</p>
              ) : (
                <button
                  type="button"
                  disabled={busy || effectiveCurrencyAvailable(fallenStars, fallenStarScrolls) < unlockCost}
                  onClick={() => void handleUnlock()}
                  title={
                    effectiveCurrencyAvailable(fallenStars, fallenStarScrolls) < unlockCost
                      ? `Need ${unlockCost} Fallen Star${unlockCost === 1 ? '' : 's'} (${
                          fallenStarScrolls > 0
                            ? `have ${fallenStars} + ${fallenStarScrolls} Scroll${fallenStarScrolls === 1 ? '' : 's'}`
                            : `have ${fallenStars}`
                        }).`
                      : undefined
                  }
                  className="w-full rounded-lg border border-emerald-600 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? 'Working…' : `Unlock Socket ${socketCount + 1} (${unlockCost} Fallen Star${unlockCost === 1 ? '' : 's'})`}
                </button>
              )
            ) : isArmor ? (
              <p className="text-center text-[10px] text-slate-500">
                Armor sockets aren't purchased — there's a small chance to gain one automatically whenever you Quality or Level Upgrade
                this item. {socketCount}/{MAX_SOCKETS} unlocked.
              </p>
            ) : (
              <p className="text-center text-[10px] text-slate-500">This item doesn't support sockets.</p>
            )}

            {socketCount > 0 && <p className="text-center text-[11px] text-slate-600">Drag a gem from below onto a socket to fill it.</p>}

            {unlockError && <p className="text-center text-[11px] text-red-400">{unlockError}</p>}
            {socketError && <p className="text-center text-[11px] text-red-400">{socketError}</p>}
          </div>
        </div>

        <InventoryPanel columns={5} reservedItemIds={selectedItemId ? [selectedItemId] : []} onTileDrop={handleTileDrop} />
      </div>
    </DragDropProvider>
  )
}
