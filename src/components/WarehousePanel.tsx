import { useState } from 'react'
import InventoryPanel from './InventoryPanel'
import WarehouseGrid from './WarehouseGrid'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useCompositionStore } from '../game/items/useCompositionStore'
import { COMPOSITION_STONE_TIERS, compositionPointValue } from '../game/items/forgeCosts'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useWarehouseStore } from '../game/items/useWarehouseStore'

type CurrencyId = 'gold' | 'meteors' | 'dragonballs'

const CURRENCIES: { id: CurrencyId; label: string }[] = [
  { id: 'gold', label: 'Gold' },
  { id: 'meteors', label: 'Meteors' },
  { id: 'dragonballs', label: 'DragonBalls' },
]

// Currency row: wallet (per-character) vs. bank (account-wide, shared across
// every character on the account) — the one thing in the Warehouse that isn't
// slot-based and isn't per-character. See useWarehouseStore's transfer_currency.
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
      <span className="text-xs text-slate-400">Wallet: {walletBalance.toLocaleString()}</span>
      <span className="text-xs text-slate-400">Bank: {bankBalance.toLocaleString()}</span>

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
      <span className="text-xs text-slate-400">Inventory: {inventoryCount}</span>
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

export default function WarehousePanel({ characterId }: { characterId: string }) {
  const points = useWarehouseStore((state) => state.points)

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Currency (shared account-wide)</p>
        <div className="mt-2 space-y-2">
          {CURRENCIES.map((currency) => (
            <CurrencyRow key={currency.id} characterId={characterId} currency={currency.id} label={currency.label} />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-xs uppercase tracking-wide text-slate-500">Composition Stones (per character)</p>
          <p className="text-xs text-slate-400">
            Warehouse Points: <span className="font-semibold text-sky-300">{points}</span>
          </p>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Depositing a stone (or composed gear) converts it into points — spend points to withdraw any tier back.
        </p>
        <div className="mt-2 space-y-2">
          {COMPOSITION_STONE_TIERS.map((tier) => (
            <StoneRow key={tier} characterId={characterId} tier={tier} />
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Gear (per character — drag from Inventory to deposit)</p>
        <div className="mt-2">
          <WarehouseGrid characterId={characterId} />
        </div>
      </div>

      <div>
        <InventoryPanel onItemDragStart={() => {}} />
      </div>
    </div>
  )
}
