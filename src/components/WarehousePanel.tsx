import { useState } from 'react'
import InventoryPanel from './InventoryPanel'
import WarehouseGrid from './WarehouseGrid'
import { DragDropProvider } from './dragDrop'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useCompositionStore } from '../game/items/useCompositionStore'
import { COMPOSITION_STONE_TIERS, compositionPointValue, parseStoneDragId } from '../game/items/forgeCosts'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useWarehouseStore } from '../game/items/useWarehouseStore'
import { LOOT_HOLDING_CAP, useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { formatItemDisplayName, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'

type CurrencyId = 'gold' | 'meteors' | 'dragonballs'

const CURRENCIES: { id: CurrencyId; label: string }[] = [
  { id: 'gold', label: 'Gold' },
  { id: 'meteors', label: 'Meteors' },
  { id: 'dragonballs', label: 'DragonBalls' },
]

// Currency row: per-character amount vs. bank (account-wide, shared across every
// character on the account) — the one thing in the Warehouse that isn't
// slot-based and isn't per-character. See useWarehouseStore's transfer_currency.
// No inline balance counters here (deliberately decluttered) — current totals
// are shown once, together, in the summary card beside Warehouse Storage below.
function CurrencyRow({ characterId, currency, label }: { characterId: string; currency: CurrencyId; label: string }) {
  // Hooks must run unconditionally every render — read every store's value up
  // front, then pick the one that matches this row's currency afterward.
  const gold = useProgressionStore((state) => state.gold)
  const meteors = useCurrencyStore((state) => state.meteors)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)
  const bankGold = usePlayerRecordStore((state) => state.bankGold)
  const bankMeteors = usePlayerRecordStore((state) => state.bankMeteors)
  const bankDragonballs = usePlayerRecordStore((state) => state.bankDragonballs)

  const walletBalance = currency === 'gold' ? gold : currency === 'meteors' ? meteors : dragonballs
  const bankBalance = currency === 'gold' ? bankGold : currency === 'meteors' ? bankMeteors : bankDragonballs

  const busy = useWarehouseStore((state) => state.busy)
  const depositCurrency = useWarehouseStore((state) => state.depositCurrency)
  const withdrawCurrency = useWarehouseStore((state) => state.withdrawCurrency)

  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = Math.floor(Number(amount))
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0

  const handleDeposit = async () => {
    setError(null)
    if (!validAmount) return
    const result = await depositCurrency(characterId, currency, parsedAmount)
    if (!result.ok) {
      setError(result.error === 'not_enough_balance' ? "You don't have that much." : 'Something went wrong.')
    } else {
      setAmount('')
    }
  }

  const handleWithdraw = async () => {
    setError(null)
    if (!validAmount) return
    const result = await withdrawCurrency(characterId, currency, parsedAmount)
    if (!result.ok) {
      setError(result.error === 'not_enough_balance' ? "The bank doesn't have that much." : 'Something went wrong.')
    } else {
      setAmount('')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <span className="w-24 text-sm font-medium text-slate-200">{label}</span>

      <input
        type="number"
        min={1}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Amount"
        className="ml-auto w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      />
      <button
        type="button"
        disabled={busy || !validAmount || walletBalance < parsedAmount}
        onClick={handleDeposit}
        className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Deposit
      </button>
      <button
        type="button"
        disabled={busy || !validAmount || bankBalance < parsedAmount}
        onClick={handleWithdraw}
        className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Withdraw
      </button>

      {error && <p className="w-full text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// Depositing a stone liquidates it into the shared Warehouse points balance
// (compositionPointValue(tier) points each); withdrawing spends that many
// points back for a fresh stone of the chosen tier. Points are fungible across
// tiers — e.g. 3 deposited tier-1 stones (30 pts) can withdraw one tier-2 stone
// (also 30 pts) — see useWarehouseStore/transfer_stone.
function StoneRow({ characterId, tier }: { characterId: string; tier: number }) {
  const inventoryCount = useCompositionStore((state) => state.stones[String(tier)] ?? 0)
  const points = useWarehouseStore((state) => state.points)
  const busy = useWarehouseStore((state) => state.busy)
  const depositStone = useWarehouseStore((state) => state.depositStone)
  const withdrawStone = useWarehouseStore((state) => state.withdrawStone)

  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = Math.floor(Number(amount))
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
  const pointValue = compositionPointValue(tier)
  const withdrawCost = parsedAmount * pointValue

  const handleDeposit = async () => {
    setError(null)
    if (!validAmount) return
    const result = await depositStone(characterId, tier, parsedAmount)
    if (!result.ok) {
      setError(result.error === 'not_enough_stones' ? "You don't have that many." : 'Something went wrong.')
    } else {
      setAmount('')
    }
  }

  const handleWithdraw = async () => {
    setError(null)
    if (!validAmount) return
    const result = await withdrawStone(characterId, tier, parsedAmount)
    if (!result.ok) {
      setError(result.error === 'not_enough_points' ? "You don't have enough Warehouse points." : 'Something went wrong.')
    } else {
      setAmount('')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <span className="w-24 text-sm font-medium text-slate-200">+{tier} Stone</span>
      <span className="text-xs text-slate-400">{pointValue} pts each</span>

      <input
        type="number"
        min={1}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Amount"
        className="ml-auto w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      />
      <button
        type="button"
        disabled={busy || !validAmount || inventoryCount < parsedAmount}
        onClick={handleDeposit}
        className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Deposit
      </button>
      <button
        type="button"
        disabled={busy || !validAmount || points < withdrawCost}
        onClick={handleWithdraw}
        className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Withdraw{validAmount ? ` (${withdrawCost} pts)` : ''}
      </button>

      {error && <p className="w-full text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// "Bank" (account-wide) vs "Warehouse" (per-character gear/stones, see
// WarehouseGrid) — a naming-only split confirmed by the user (2026-07-30), not
// a behavior change: currency was already account-wide-shared and gear/stones
// were already per-character-only, this just names the account-wide side
// "Bank" instead of leaving everything under the one "Warehouse" label. One
// consolidated card for everything account-wide/points-based — totals plus the
// actual deposit/withdraw controls for all 3 currencies and all 4 stone tiers.
function BankCard({ characterId }: { characterId: string }) {
  const points = useWarehouseStore((state) => state.points)
  const gold = useProgressionStore((state) => state.gold)
  const meteors = useCurrencyStore((state) => state.meteors)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)
  const bankGold = usePlayerRecordStore((state) => state.bankGold)
  const bankMeteors = usePlayerRecordStore((state) => state.bankMeteors)
  const bankDragonballs = usePlayerRecordStore((state) => state.bankDragonballs)

  return (
    <div className="h-fit space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Bank</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">Warehouse Points</dt>
            <dd className="font-semibold text-sky-300">{points.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">Gold (Wallet / Bank)</dt>
            <dd className="font-semibold text-amber-300">
              {gold.toLocaleString()} / {bankGold.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">Meteors (Wallet / Bank)</dt>
            <dd className="font-semibold text-slate-200">
              {meteors.toLocaleString()} / {bankMeteors.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">DragonBalls (Wallet / Bank)</dt>
            <dd className="font-semibold text-slate-200">
              {dragonballs.toLocaleString()} / {bankDragonballs.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>

      <div className="space-y-2">
        {CURRENCIES.map((currency) => (
          <CurrencyRow key={currency.id} characterId={characterId} currency={currency.id} label={currency.label} />
        ))}
      </div>

      <div>
        <p className="text-[11px] text-slate-500">
          Depositing a stone (or composed gear) converts it into points — spend points to withdraw any tier back.
        </p>
        <div className="mt-2 space-y-2">
          {COMPOSITION_STONE_TIERS.map((tier) => (
            <StoneRow key={tier} characterId={characterId} tier={tier} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Loot Holding (confirmed with the user, 2026-07-30): where a server-resolved
// kill's item drop lands when Inventory is full — see useLootHoldingStore and
// supabase/functions/resolve-combat. Nothing to drag here, just a "Claim"
// button per entry, since these are already-granted rewards waiting for room
// rather than something to choose a tier for.
function LootHoldingCard() {
  const entries = useLootHoldingStore((state) => state.entries)
  const busy = useLootHoldingStore((state) => state.busy)
  const claim = useLootHoldingStore((state) => state.claim)
  const templates = useItemTemplatesStore((state) => state.templates)

  if (entries.length === 0) {
    return null
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Loot Holding ({entries.length}/{LOOT_HOLDING_CAP})
      </p>
      <p className="text-[11px] text-slate-500">
        Drops that couldn't fit in Inventory land here — claim them once you have room.
      </p>

      <div className="space-y-2">
        {entries.map((entry) => {
          const template = templates.find((t) => t.id === entry.template_id)
          const label = template ? formatItemDisplayName(template.name, entry.quality_tier) : 'Unknown item'

          return (
            <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-sm"
                style={{ borderColor: getQualityColor(entry.quality_tier) }}
              >
                {getItemIcon(template?.slot_type)}
              </div>
              <span className="flex-1 truncate text-sm text-slate-200">{label}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void claim(entry.id)}
                className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Claim
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function WarehousePanel({ characterId }: { characterId: string }) {
  const withdrawItem = useWarehouseStore((state) => state.withdrawItem)
  const depositItem = useWarehouseStore((state) => state.depositItem)
  const depositStone = useWarehouseStore((state) => state.depositStone)
  const items = useWarehouseStore((state) => state.items)

  // Routes a dragged tile to whichever side it landed on, identified by that
  // side's data-drop-zone key (see dragDrop.tsx) — "warehouse-storage" means a
  // grid or stone tile was dragged in from Inventory to deposit; "inventory"
  // means a Warehouse tile was dragged out to withdraw it at the free Normal
  // tier (a shortcut for the common case — the click-to-select detail card in
  // WarehouseGrid still handles choosing a paid composition tier).
  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'warehouse-storage') {
      const stoneTier = parseStoneDragId(id)
      if (stoneTier !== null) {
        void depositStone(characterId, stoneTier, 1)
      } else {
        void depositItem(characterId, id)
      }
      return
    }

    if (overTarget === 'inventory' && items.some((entry) => entry.template_id === id)) {
      void withdrawItem(characterId, id, 0)
    }
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Gear (drag between Inventory and Warehouse Storage to deposit/withdraw)
      </p>
      <DragDropProvider>
        <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <WarehouseGrid characterId={characterId} onTileDrop={handleTileDrop} />
            <InventoryPanel onTileDrop={handleTileDrop} />
          </div>

          <div className="space-y-4">
            <BankCard characterId={characterId} />
            <LootHoldingCard />
          </div>
        </div>
      </DragDropProvider>
    </div>
  )
}
