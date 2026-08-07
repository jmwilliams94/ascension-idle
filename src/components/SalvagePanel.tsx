import InventoryPanel from './InventoryPanel'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'

// Forge's Salvage tab (confirmed with the user, 2026-08-07) — a simple,
// self-contained sibling of ShopPanel's own Sell flow: pick unwanted gear
// out of the reused Inventory grid and exchange it for Ascension Points
// only, no gold. See InventoryPanel's enableSalvaging prop for the actual
// bulk/single-item selection UI, and salvage_item (Postgres RPC) for the
// per-quality-tier AP payout.
export default function SalvagePanel() {
  const ascensionPoints = usePlayerRecordStore((state) => state.ascensionPoints)

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-center text-xs text-slate-400">
        <p>Salvage unwanted gear for Ascension Points — no gold, but a better AP payout than selling.</p>
        <p className="mt-1 text-purple-300">Ascension Points: {ascensionPoints}</p>
      </div>

      <InventoryPanel columns={5} enableSalvaging />
    </div>
  )
}
