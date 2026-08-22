import { useState } from 'react'
import { useGearClaimPromptStore } from '../game/items/useGearClaimPromptStore'
import { useGearSnapshotStore } from '../game/items/useGearSnapshotStore'

// Gear Score Snapshot claim-transfer prompt (requested by the user) — shown
// when equipping an item that's currently snapshotted onto a different
// character. The equip already happened (see InventoryPanel.tsx's
// handleEquip) regardless of what happens here; Confirm re-calls
// claim_gear_snapshot with force=true, moving the Gear Score credit onto
// this character and removing it from the other one. Cancel just closes —
// the other character keeps the credit (a "stale but frozen" claim) until
// they equip something else in that slot or someone accepts a future
// transfer for the same item.
export default function GearSnapshotClaimModal() {
  const pending = useGearClaimPromptStore((state) => state.pending)
  const clear = useGearClaimPromptStore((state) => state.clear)
  const claimSnapshot = useGearSnapshotStore((state) => state.claimSnapshot)
  const [busy, setBusy] = useState(false)

  if (!pending) {
    return null
  }

  const handleConfirm = async () => {
    setBusy(true)
    await claimSnapshot(pending.characterId, pending.slot, pending.itemId, true)
    setBusy(false)
    clear()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={clear}>
      <div
        className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm text-slate-200">
          <span className="font-semibold text-amber-300">{pending.claimedByCharacterName}</span>'s Gear Score currently
          includes this item. Claim it for this character instead?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            className="flex-1 rounded-lg border border-amber-500 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Claiming…' : 'Claim for this character'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={clear}
            className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-300 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
