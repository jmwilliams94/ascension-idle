import { useState } from 'react'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import WarehouseGrid from './WarehouseGrid'
import { DragDropProvider } from './dragDrop'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useCompositionStore } from '../game/items/useCompositionStore'
import {
  COMPOSITION_STONE_TIERS,
  GEAR_SLOT_TYPES,
  compositionPointValue,
  formatGearSlotLabel,
  parseStoneDragId,
  type GearSlotType,
} from '../game/items/forgeCosts'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useWarehouseStore } from '../game/items/useWarehouseStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
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
// Stage 5 (the "Banked" card, 2026-07-31): each row is collapsed to just its
// Wallet/Bank totals plus Deposit/Withdraw buttons — tapping either reveals
// that direction's own amount input instead of showing two always-visible
// inputs at once, the same reveal-on-tap interaction GearCompositionRow
// already established in stage 4. Confirmed with the user: both directions
// stay (not Withdraw-only) since Gold/Meteors/DragonBalls have no
// drag-and-drop deposit alternative the way gear/stones do.
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

  const [openMode, setOpenMode] = useState<'deposit' | 'withdraw' | null>(null)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = Math.floor(Number(amount))
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
  const availableForMode = openMode === 'deposit' ? walletBalance : bankBalance

  const toggleMode = (mode: 'deposit' | 'withdraw') => {
    setOpenMode((current) => (current === mode ? null : mode))
    setAmount('')
    setError(null)
  }

  const handleConfirm = async () => {
    if (!openMode || !validAmount) {
      return
    }
    setError(null)
    const result =
      openMode === 'deposit'
        ? await depositCurrency(characterId, currency, parsedAmount)
        : await withdrawCurrency(characterId, currency, parsedAmount)
    if (!result.ok) {
      setError(
        result.error === 'not_enough_balance'
          ? openMode === 'deposit'
            ? "You don't have that much."
            : "The bank doesn't have that much."
          : 'Something went wrong.',
      )
    } else {
      setAmount('')
      setOpenMode(null)
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-sm font-medium text-slate-200">{label}</span>
        <span className="text-xs text-slate-400">
          {walletBalance.toLocaleString()} / {bankBalance.toLocaleString()}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => toggleMode('deposit')}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              openMode === 'deposit'
                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() => toggleMode('withdraw')}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              openMode === 'withdraw'
                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Withdraw
          </button>
        </div>
      </div>

      {openMode && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Amount"
            className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          />
          <button
            type="button"
            disabled={busy || !validAmount || availableForMode < parsedAmount}
            onClick={() => void handleConfirm()}
            className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirm {openMode === 'deposit' ? 'Deposit' : 'Withdraw'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// Stage 5 (2026-07-31): the four always-visible per-tier StoneRows collapse
// into a single "Stones" line — a tier picker + amount input, revealed only
// after tapping Deposit or Withdraw, same interaction CurrencyRow/
// GearCompositionRow now use. Depositing a stone liquidates it into the
// shared Warehouse Points balance (compositionPointValue(tier) points each);
// withdrawing spends that many points back for a fresh stone of the chosen
// tier. Points are fungible across tiers — e.g. 3 deposited tier-1 stones
// (30 pts) can withdraw one tier-2 stone (also 30 pts) — see
// useWarehouseStore/transfer_stone.
function StonesRow({ characterId }: { characterId: string }) {
  const stones = useCompositionStore((state) => state.stones)
  const points = useWarehouseStore((state) => state.points)
  const busy = useWarehouseStore((state) => state.busy)
  const depositStone = useWarehouseStore((state) => state.depositStone)
  const withdrawStone = useWarehouseStore((state) => state.withdrawStone)

  const [openMode, setOpenMode] = useState<'deposit' | 'withdraw' | null>(null)
  const [tier, setTier] = useState<number>(COMPOSITION_STONE_TIERS[0])
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = Math.floor(Number(amount))
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
  const pointValue = compositionPointValue(tier)
  const cost = parsedAmount * pointValue
  const ownedAtTier = stones[String(tier)] ?? 0

  const toggleMode = (mode: 'deposit' | 'withdraw') => {
    setOpenMode((current) => (current === mode ? null : mode))
    setAmount('')
    setError(null)
  }

  const handleConfirm = async () => {
    if (!openMode || !validAmount) {
      return
    }
    setError(null)
    const result =
      openMode === 'deposit' ? await depositStone(characterId, tier, parsedAmount) : await withdrawStone(characterId, tier, parsedAmount)
    if (!result.ok) {
      setError(
        result.error === 'not_enough_stones'
          ? "You don't have that many."
          : result.error === 'not_enough_points'
            ? "You don't have enough Warehouse points."
            : 'Something went wrong.',
      )
    } else {
      setAmount('')
      setOpenMode(null)
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-sm font-medium text-slate-200">Stones</span>
        <span className="text-xs text-slate-400">{points.toLocaleString()} pts</span>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => toggleMode('deposit')}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              openMode === 'deposit'
                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() => toggleMode('withdraw')}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              openMode === 'withdraw'
                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Withdraw
          </button>
        </div>
      </div>

      {openMode && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {COMPOSITION_STONE_TIERS.map((stoneTier) => (
              <button
                key={stoneTier}
                type="button"
                onClick={() => setTier(stoneTier)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                  tier === stoneTier
                    ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                +{stoneTier} ({compositionPointValue(stoneTier)} pts)
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Amount"
              className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            />
            <button
              type="button"
              disabled={
                busy || !validAmount || (openMode === 'deposit' ? ownedAtTier < parsedAmount : points < cost)
              }
              onClick={() => void handleConfirm()}
              className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirm {openMode === 'deposit' ? 'Deposit' : `Withdraw${validAmount ? ` (${cost} pts)` : ''}`}
            </button>
          </div>

          {openMode === 'deposit' && <p className="text-[10px] text-slate-500">You own {ownedAtTier} tier +{tier} stone(s).</p>}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// Gear's second, independent deposit path (stage 4 of the Warehouse economy
// redesign, 2026-07-31) — "Deposit as Item" (drag onto Warehouse Storage,
// above) is unchanged; dropping a gear tile here instead destroys it outright
// and cashes only its composition tier into a pool scoped to that item's own
// slot_type (weapon/ring/necklace/boots/hat/coat — six separate, non-fungible
// pools, distinct from the shared Warehouse Points balance above). No
// quantity/tier picker for depositing — same "drag one item at a time"
// convention as depositing a gear item as a token.
function CompositionDropZone() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-purple-800/60 bg-purple-950/10 px-3 py-2">
      <div data-drop-zone="composition-pool" className={`${SLOT_SIZE_CLASS} shrink-0`}>
        <InventorySlot slotId="composition-drop-zone" filled={false} sizeClassName={SLOT_SIZE_CLASS} emptyHint="Drop here" />
      </div>
      <p className="text-xs text-slate-400">
        <span className="font-medium text-purple-300">Deposit as Composition</span> — destroys the item and its stats/quality/level,
        banking only its composition tier as points for that gear slot (see Gear Points below), instead of storing the item itself.
      </p>
    </div>
  )
}

// One row per slot_type pool. Withdrawing needs a template chosen up front —
// unlike withdraw_item (a fungible per-template token), this pool tracks no
// template identity at all, so the player picks any template of the matching
// slot_type (filtered to their own class, same as the Shop's own availability
// check) before choosing a tier to pay for. Picker only reveals on tapping
// Withdraw — the same "reveal on tap" interaction stage 5 later applied to
// every other row in the Banked card below (CurrencyRow/StonesRow) too.
function GearCompositionRow({ characterId, slotType }: { characterId: string; slotType: GearSlotType }) {
  const points = useWarehouseStore((state) => state.gearCompositionPoints[slotType])
  const busy = useWarehouseStore((state) => state.busy)
  const withdrawGearComposition = useWarehouseStore((state) => state.withdrawGearComposition)
  const templates = useItemTemplatesStore((state) => state.templates)
  const classId = useCharacterStore((state) => state.selectedClassId)

  const [open, setOpen] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [tier, setTier] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const eligibleTemplates = templates
    .filter((template) => template.slot_type === slotType && (template.required_class === null || template.required_class === classId))
    .sort((a, b) => a.required_level - b.required_level)

  const cost = compositionPointValue(tier)

  const handleWithdraw = async () => {
    setError(null)
    if (!templateId) {
      return
    }
    const result = await withdrawGearComposition(characterId, templateId, tier)
    if (!result.ok) {
      setError(
        result.error === 'inventory_full'
          ? 'Inventory is full.'
          : result.error === 'not_enough_points'
            ? "You don't have enough points for this slot."
            : "Couldn't withdraw that item.",
      )
    } else {
      setOpen(false)
      setTemplateId('')
      setTier(0)
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-sm font-medium text-slate-200">{formatGearSlotLabel(slotType)}</span>
        <span className="text-xs text-slate-400">{points.toLocaleString()} pts</span>
        <button
          type="button"
          onClick={() => {
            setOpen((current) => !current)
            setError(null)
          }}
          className="ml-auto rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-400"
        >
          {open ? 'Cancel' : 'Withdraw'}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {eligibleTemplates.length === 0 ? (
            <p className="text-xs text-slate-500">No {formatGearSlotLabel(slotType).toLowerCase()} items available for your class.</p>
          ) : (
            <>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
              >
                <option value="">Choose an item…</option>
                {eligibleTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} (Lv {template.required_level})
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTier(0)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                    tier === 0 ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  Normal (free)
                </button>
                {COMPOSITION_STONE_TIERS.map((stoneTier) => (
                  <button
                    key={stoneTier}
                    type="button"
                    onClick={() => setTier(stoneTier)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                      tier === stoneTier
                        ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                        : 'border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    +{stoneTier} ({compositionPointValue(stoneTier)} pts)
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={busy || !templateId || points < cost}
                onClick={() => void handleWithdraw()}
                className="w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Withdraw{cost > 0 ? ` (${cost} pts)` : ''}
              </button>
            </>
          )}

          {error && <p className="text-xs text-amber-400">{error}</p>}
        </div>
      )}
    </div>
  )
}

// "Banked" (stage 5 of the Warehouse economy redesign, 2026-07-31) — replaces
// BankCard. Same underlying account-wide/points-based data (currency Wallet
// vs. account Bank, Warehouse Points, per-slot-type Gear Points), but every
// row now shows just its running total(s) plus Deposit/Withdraw buttons —
// the amount input (and, for Stones/Gear Points, the tier/template picker)
// only reveals once a button is tapped, rather than sitting always-visible.
// "Bank" vs "Warehouse" (per-character gear/stones, see WarehouseGrid)
// remains a naming-only split confirmed 2026-07-30 — not a behavior change,
// just which side of the account-wide/per-character split a label refers to.
function BankedCard({ characterId }: { characterId: string }) {
  return (
    <div className="h-fit space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Banked</p>

      <div className="space-y-2">
        {CURRENCIES.map((currency) => (
          <CurrencyRow key={currency.id} characterId={characterId} currency={currency.id} label={currency.label} />
        ))}
      </div>

      <div>
        <p className="text-[11px] text-slate-500">
          Depositing a stone (or composed gear as an item) converts it into points — spend points to withdraw any tier back.
        </p>
        <div className="mt-2">
          <StonesRow characterId={characterId} />
        </div>
      </div>

      <div>
        <p className="text-[11px] text-slate-500">
          Gear Points: dropping an item on "Deposit as Composition" (below) banks its tier here instead — six separate pools, one per
          gear slot, not fungible with each other or with Warehouse Points above.
        </p>
        <div className="mt-2 space-y-2">
          {GEAR_SLOT_TYPES.map((slotType) => (
            <GearCompositionRow key={slotType} characterId={characterId} slotType={slotType} />
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
          // Currency-type entries (Meteor/DragonBall) have no template at all —
          // see useLootHoldingStore's 2026-07-31 extension.
          if (entry.currency_type) {
            const label = entry.currency_type === 'meteor' ? 'Meteor' : 'DragonBall'

            return (
              <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-sm">
                  {entry.currency_type === 'meteor' ? '🌠' : '🔮'}
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
          }

          const template = templates.find((t) => t.id === entry.template_id)
          const label = template && entry.quality_tier ? formatItemDisplayName(template.name, entry.quality_tier) : 'Unknown item'

          return (
            <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-sm"
                style={{ borderColor: getQualityColor(entry.quality_tier ?? 'normal') }}
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
  const depositItemAsComposition = useWarehouseStore((state) => state.depositItemAsComposition)
  const depositStone = useWarehouseStore((state) => state.depositStone)
  const items = useWarehouseStore((state) => state.items)

  // Routes a dragged tile to whichever side it landed on, identified by that
  // side's data-drop-zone key (see dragDrop.tsx) — "warehouse-storage" means a
  // grid or stone tile was dragged in from Inventory to deposit; "inventory"
  // means a Warehouse tile was dragged out to withdraw it at the free Normal
  // tier (a shortcut for the common case — the click-to-select detail card in
  // WarehouseGrid still handles choosing a paid composition tier);
  // "composition-pool" (stage 4) deposits a real gear item's composition tier
  // into its slot_type's points pool instead, destroying the item outright —
  // stone/currency/scroll synthetic ids aren't real item_instances rows and
  // are silently ignored here (parseStoneDragId already excludes stones; the
  // items.some check excludes everything else that isn't a real gear item).
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

    if (overTarget === 'composition-pool' && useInventoryStore.getState().items.some((item) => item.id === id)) {
      void depositItemAsComposition(id)
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
        {/* min-w-0 on both columns: grid items default to min-width:auto (content-
            based), so without it a wide unwrapped row (e.g. BankCard's
            currency/stone rows below) grows the whole grid track — and the
            whole page — wider than the viewport instead of actually wrapping,
            even though the row itself has flex-wrap. */}
        <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-4">
            <WarehouseGrid characterId={characterId} onTileDrop={handleTileDrop} />
            <CompositionDropZone />
            <InventoryPanel onTileDrop={handleTileDrop} />
          </div>

          <div className="min-w-0 space-y-4">
            <BankedCard characterId={characterId} />
            <LootHoldingCard />
          </div>
        </div>
      </DragDropProvider>
    </div>
  )
}
