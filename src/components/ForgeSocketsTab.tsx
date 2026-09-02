import { useState } from 'react'
import EquippedGearPicker from './EquippedGearPicker'
import ForgeSocketSlot from './ForgeSocketSlot'
import ForgeTwoColumnLayout from './ForgeTwoColumnLayout'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import InventoryPanel from './InventoryPanel'
import { DragDropProvider } from './dragDrop'
import { Button } from './ui/Button'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useForgeStore } from '../game/items/useForgeStore'
import { effectiveCurrencyAvailable } from '../game/items/forgeCosts'
import { parseGemDragId, type GemTier, type GemTypeId } from '../game/items/gemTypes'
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
    case 'no_sockets_on_pickaxe':
      return "Pickaxe can't take sockets."
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
// per the user's explicit "gems can never be removed." Because of that,
// dropping a gem only stages it as a pending preview (see pendingSocket) —
// the RPC doesn't fire until the player hits Confirm.
interface ForgeSocketsTabProps {
  onBack: () => void
}

export default function ForgeSocketsTab({ onBack }: ForgeSocketsTabProps) {
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
  // A gem dropped onto a socket but not yet confirmed — see handleConfirmSocket.
  // Socketing is irreversible (gems can never be removed), so the drop only
  // stages a preview; the RPC doesn't fire until the player explicitly confirms.
  const [pendingSocket, setPendingSocket] = useState<{ index: number; gemId: GemTypeId; tier: GemTier } | null>(null)
  // Mobile tap-to-place target (2026-09-02) — see ForgeSocketSlot's own
  // `selected`/`onSelect` doc comment. Tapping a socket sets this; the next
  // tapped gem (InventoryPanel's generic 'gem' drop key) fills it.
  const [selectedSocketIndex, setSelectedSocketIndex] = useState<number | null>(null)

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  const socketCount = selectedItem?.sockets.length ?? 0
  // Pickaxe is slot_type 'weapon' (a normal Main Hand weapon) but doesn't get
  // sockets — requested by the user, progression stays exclusively on the
  // bespoke Tier Up system (see unlock_weapon_socket's own item_family guard).
  const isPickaxe = selectedTemplate?.item_family === 'pickaxe'
  const isWeapon = selectedTemplate?.slot_type === 'weapon' && !isPickaxe
  const isArmor = selectedTemplate ? ARMOR_SLOT_TYPES.includes(selectedTemplate.slot_type) : false
  const maxed = socketCount >= MAX_SOCKETS
  const unlockCost = socketCount === 0 ? 1 : 5

  const handleRemoveItem = () => {
    setSelectedItemId(null)
    setUnlockError(null)
    setSocketError(null)
    setPendingSocket(null)
    setSelectedSocketIndex(null)
  }

  const handleDropItemId = (itemId: string) => {
    if (!items.some((item) => item.id === itemId)) {
      return
    }
    setSelectedItemId(itemId)
    setUnlockError(null)
    setSocketError(null)
    setPendingSocket(null)
    setSelectedSocketIndex(null)
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

  // Stages the dropped gem as a pending preview rather than socketing it
  // immediately — the player must hit Confirm before it actually consumes
  // the gem, since a socketed gem can never be removed.
  const handleDropGem = (socketIndex: number, id: string) => {
    if (!selectedItem || socketIndex >= socketCount) {
      return
    }
    const parsed = parseGemDragId(id)
    if (!parsed) {
      return
    }
    setSocketError(null)
    setPendingSocket({ index: socketIndex, gemId: parsed.gemId, tier: parsed.tier })
  }

  const handleCancelSocket = () => {
    setPendingSocket(null)
    setSocketError(null)
  }

  const handleConfirmSocket = async () => {
    if (!selectedItem || !pendingSocket) {
      return
    }
    setSocketError(null)
    const result = await socketGem(selectedItem.id, pendingSocket.index, pendingSocket.gemId, pendingSocket.tier)
    if (!result.ok) {
      setSocketError(describeSocketFailure(result.error))
    }
    setPendingSocket(null)
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleDropItemId(id)
      return
    }
    if (overTarget === 'socket-0') {
      handleDropGem(0, id)
      return
    }
    if (overTarget === 'socket-1') {
      handleDropGem(1, id)
      return
    }
    if (overTarget === 'gem') {
      // Mobile tap-to-place (see ForgeSocketSlot's selected/onSelect doc
      // comment) — a tapped gem can't say which socket it means on its own,
      // so it's routed here at whichever socket the player tapped first.
      // No-ops if none is selected yet, same as a real drag missing every
      // drop zone would.
      if (selectedSocketIndex !== null) {
        handleDropGem(selectedSocketIndex, id)
      }
    }
  }

  // Coarser than handleDropGem's own per-socket index check (there's no
  // single "eligible" answer once one socket is unlocked and the other
  // isn't) — a gem tile dims only once *no* socket could take it at all
  // (socketCount 0, e.g. before Unlock is pressed, or an armor piece that
  // hasn't proc'd one yet).
  const isTileEligible = (dragId: string): boolean => {
    if (!selectedItem) {
      return items.some((item) => item.id === dragId)
    }

    return socketCount > 0 && parseGemDragId(dragId) !== null
  }

  return (
    <DragDropProvider>
      <ForgeTwoColumnLayout
        title="Sockets"
        onBack={onBack}
        inventory={
          <InventoryPanel
            columns={5}
            reservedItemIds={selectedItemId ? [selectedItemId] : []}
            onTileDrop={handleTileDrop}
            isTileEligible={isTileEligible}
            tapToPlaceEnabled
          />
        }
      >
          <div className="flex items-start justify-center gap-6">
            <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemoveItem} />
            <ForgeSocketSlot
              index={0}
              unlocked={socketCount >= 1}
              filledKey={selectedItem?.sockets[0] ?? null}
              pendingGem={pendingSocket?.index === 0 ? pendingSocket : null}
              selected={selectedSocketIndex === 0}
              onSelect={() => setSelectedSocketIndex(0)}
            />
            <ForgeSocketSlot
              index={1}
              unlocked={socketCount >= 2}
              filledKey={selectedItem?.sockets[1] ?? null}
              pendingGem={pendingSocket?.index === 1 ? pendingSocket : null}
              selected={selectedSocketIndex === 1}
              onSelect={() => setSelectedSocketIndex(1)}
            />
          </div>

          {!selectedItem && <EquippedGearPicker onSelect={handleDropItemId} />}

          <div className="w-full max-w-xs space-y-2">
            {!selectedItem ? (
              <p className="text-center text-[11px] text-slate-300">Tap or drag an item into the slot on the left, or tap one you have equipped.</p>
            ) : isWeapon ? (
              maxed ? (
                <p className="text-center text-[10px] text-slate-300">Both sockets unlocked.</p>
              ) : (
                <Button
                  variant="primary"
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
                  className="w-full"
                >
                  {busy ? 'Working…' : `Unlock Socket ${socketCount + 1} (${unlockCost} Fallen Star${unlockCost === 1 ? '' : 's'})`}
                </Button>
              )
            ) : isArmor ? (
              <p className="text-center text-[10px] text-slate-300">
                Armor sockets aren't purchased — there's a small chance to gain one automatically whenever you Quality or Level Upgrade
                this item. {socketCount}/{MAX_SOCKETS} unlocked.
              </p>
            ) : (
              <p className="text-center text-[10px] text-slate-300">This item doesn't support sockets.</p>
            )}

            {socketCount > 0 && !pendingSocket && (
              <p className="text-center text-[11px] text-slate-300">
                Drag a gem from below onto a socket to fill it, or tap a socket then tap a gem.
              </p>
            )}

            {pendingSocket && (
              <div className="space-y-2">
                <p className="text-center text-[11px] text-amber-400">
                  Gems can never be removed once socketed. Confirm to lock this in.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void handleConfirmSocket()} className="flex-1">
                    {busy ? 'Working…' : 'Confirm Socket'}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={handleCancelSocket} className="flex-1">
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {unlockError && <p className="text-center text-[11px] text-red-400">{unlockError}</p>}
            {socketError && <p className="text-center text-[11px] text-red-400">{socketError}</p>}
          </div>
      </ForgeTwoColumnLayout>
    </DragDropProvider>
  )
}
