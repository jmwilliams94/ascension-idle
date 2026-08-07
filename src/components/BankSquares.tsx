import { useState } from 'react'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import BankActionModal from './BankActionModal'
import {
  COMPOSITION_STONE_TIERS,
  GEAR_SLOT_TYPES,
  compositionPointValue,
  formatGearSlotLabel,
  type GearSlotType,
  COMET_ICON_SRC,
  FALLEN_STAR_ICON_SRC,
  FALLEN_STAR_COLOR,
  MATERIAL_COLOR,
} from '../game/items/forgeCosts'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useBankStore } from '../game/items/useBankStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
// The per-action floating "+gained" toast (2026-08-07, confirmed with the
// user) — fired for every deliberate Bank deposit/withdraw here, mirroring
// the same call ShopPanel/SalvagePanel's own sell/salvage flows make.
import { useGainToastStore } from '../game/hud/useGainToastStore'

// Per-transaction slider cap (2026-08-07, confirmed with the user) — the
// slider always runs 0-40 regardless of how much is actually banked/owned,
// clamped further down by whatever's actually available to move. Matches
// the Inventory slot cap so a single Bank action never asks for more than
// could ever be held as tiles anyway.
const BANK_ACTION_SLIDER_CAP = 40

type CurrencyId = 'gold' | 'comets' | 'fallen_stars'

// Icon sources for the 3-per-row square redesign below (2026-08-07,
// confirmed with the user) — Gold has no dedicated icon asset, so it stays
// label-only, matching the user's own "if there's no icon we can just leave
// it as text for the moment."
const CURRENCY_ICON_SRC: Partial<Record<CurrencyId, string>> = {
  comets: COMET_ICON_SRC,
  fallen_stars: FALLEN_STAR_ICON_SRC,
}

const CURRENCIES: { id: CurrencyId; label: string }[] = [
  { id: 'gold', label: 'Gold' },
  { id: 'comets', label: 'Comets' },
  { id: 'fallen_stars', label: 'Fallen Stars' },
]

type SelectedSquare =
  | { kind: 'currency'; id: CurrencyId }
  | { kind: 'stoneTier'; tier: number }
  | { kind: 'compositionPoints' }
  | { kind: 'gearSlot'; slotType: GearSlotType }
  | null

function squareKey(square: NonNullable<SelectedSquare>): string {
  switch (square.kind) {
    case 'currency':
      return `currency:${square.id}`
    case 'stoneTier':
      return `stoneTier:${square.tier}`
    case 'compositionPoints':
      return 'compositionPoints'
    case 'gearSlot':
      return `gearSlot:${square.slotType}`
  }
}

// Bank tab rework (2026-08-03, confirmed with the user) — replaces
// BankedCard's row-based layout (CurrencyRow/StonesRow/GearCompositionRow)
// with a grid of simple squares: label on top, quantity underneath, nothing
// more. Always rendered regardless of the Inventory/Storage toggle in
// BankPanel — these are account-wide totals, independent of which side
// the main grid is currently showing.
//
// Each square shows a *different* pool than the physical Bank Storage grid
// (BankGrid) — these are all liquidated/converted balances (currency
// Bank balances, banked stone-tile counts, and the two points-conversion
// pools), not physical item tiles. Depositing into most of these now happens
// via the per-item "Bank"/"Deposit" popover in the Inventory-side grid
// (InventoryPanel's enableBankDeposit) instead of from here — clicking a
// square mostly reveals a Withdraw control, except currency (Gold has no
// Inventory tile at all, so its own square is the only place to move it
// either direction) and the two points-conversion pools (nothing to
// "deposit" directly into a points balance except by spending a stone/gear
// item via the Bank button — the square only ever spends points, it doesn't
// mint them).
export default function BankSquares({
  characterId,
  onWithdrawLandedInInventory,
}: {
  characterId: string
  // Called after a withdrawal that actually adds something to the
  // Character Inventory grid (Comets/Fallen Stars, a physical stone, a
  // Composition-Points stone, or a Gear-Points item) — lets BankPanel
  // auto-switch its own toggle to the Character view so the result is
  // immediately visible, rather than staying on "Account" (which never
  // shows any of these) and looking like nothing happened.
  onWithdrawLandedInInventory?: () => void
}) {
  const gold = useProgressionStore((state) => state.gold)
  const comets = useCurrencyStore((state) => state.comets)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const bankGold = usePlayerRecordStore((state) => state.bankGold)
  const bankComets = usePlayerRecordStore((state) => state.bankComets)
  const bankFallenStars = usePlayerRecordStore((state) => state.bankFallenStars)
  const stonesBanked = usePlayerRecordStore((state) => state.stonesBanked)
  const bankPoints = usePlayerRecordStore((state) => state.bankPoints)
  const gearCompositionPoints = usePlayerRecordStore((state) => state.gearCompositionPoints)

  const busy = useBankStore((state) => state.busy)
  const depositCurrency = useBankStore((state) => state.depositCurrency)
  const withdrawCurrency = useBankStore((state) => state.withdrawCurrency)
  const withdrawStoneItem = useBankStore((state) => state.withdrawStoneItem)
  const withdrawStone = useBankStore((state) => state.withdrawStone)
  const withdrawGearComposition = useBankStore((state) => state.withdrawGearComposition)

  const [selected, setSelected] = useState<SelectedSquare>(null)

  const toggle = (square: NonNullable<SelectedSquare>) => {
    setSelected((current) => (current && squareKey(current) === squareKey(square) ? null : square))
  }

  const walletFor = (id: CurrencyId) => (id === 'gold' ? gold : id === 'comets' ? comets : fallenStars)
  const bankFor = (id: CurrencyId) => (id === 'gold' ? bankGold : id === 'comets' ? bankComets : bankFallenStars)

  const closeModal = () => setSelected(null)

  return (
    <div className="h-fit space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Account Bank</p>

      <div className="grid grid-cols-3 gap-2">
        {CURRENCIES.map((currency) => (
          <Square
            key={currency.id}
            label={currency.label}
            value={bankFor(currency.id)}
            iconSrc={CURRENCY_ICON_SRC[currency.id]}
            accentColor={currency.id === 'comets' ? MATERIAL_COLOR : currency.id === 'fallen_stars' ? FALLEN_STAR_COLOR : undefined}
            selected={selected?.kind === 'currency' && selected.id === currency.id}
            onClick={() => toggle({ kind: 'currency', id: currency.id })}
          />
        ))}
        {COMPOSITION_STONE_TIERS.map((tier) => (
          <Square
            key={tier}
            label={`Tier ${tier} Stone`}
            value={stonesBanked[String(tier)] ?? 0}
            // No dedicated stone icon art yet (see forgeCosts.ts's own
            // buildStoneTooltip, which uses this same emoji) — the corner
            // "+N" badge is what tells the 4 otherwise-identical stone
            // squares apart at a glance.
            icon="🔷"
            cornerLabel={`+${tier}`}
            accentColor={MATERIAL_COLOR}
            selected={selected?.kind === 'stoneTier' && selected.tier === tier}
            onClick={() => toggle({ kind: 'stoneTier', tier })}
          />
        ))}
        <Square
          label="Composition Points"
          value={bankPoints}
          selected={selected?.kind === 'compositionPoints'}
          onClick={() => toggle({ kind: 'compositionPoints' })}
        />
        {GEAR_SLOT_TYPES.map((slotType) => (
          <Square
            key={slotType}
            label={`${formatGearSlotLabel(slotType)} Points`}
            value={gearCompositionPoints[slotType]}
            selected={selected?.kind === 'gearSlot' && selected.slotType === slotType}
            onClick={() => toggle({ kind: 'gearSlot', slotType })}
          />
        ))}
      </div>

      {selected?.kind === 'currency' && (
        <BankActionModal
          title={CURRENCIES.find((c) => c.id === selected.id)!.label}
          subtitle="Move currency between your Wallet and the account Bank."
          onClose={closeModal}
        >
          <CurrencyPanel
            currencyId={selected.id}
            label={CURRENCIES.find((c) => c.id === selected.id)!.label}
            wallet={walletFor(selected.id)}
            bank={bankFor(selected.id)}
            iconSrc={CURRENCY_ICON_SRC[selected.id]}
            busy={busy}
            onDeposit={(amount) => depositCurrency(characterId, selected.id, amount)}
            onWithdraw={(amount) => withdrawCurrency(characterId, selected.id, amount)}
            onDone={closeModal}
            onLanded={onWithdrawLandedInInventory}
          />
        </BankActionModal>
      )}

      {selected?.kind === 'stoneTier' && (
        <BankActionModal title={`Tier ${selected.tier} Stone`} subtitle="Withdraw one physically-banked stone at a time." onClose={closeModal}>
          <StoneTierPanel
            tier={selected.tier}
            owned={stonesBanked[String(selected.tier)] ?? 0}
            busy={busy}
            onWithdraw={() => withdrawStoneItem(characterId, selected.tier, 1)}
            onDone={() => {
              closeModal()
              onWithdrawLandedInInventory?.()
            }}
          />
        </BankActionModal>
      )}

      {selected?.kind === 'compositionPoints' && (
        <BankActionModal title="Composition Points" subtitle="Spend points for one stone at a chosen tier." onClose={closeModal}>
          <CompositionPointsPanel
            points={bankPoints}
            busy={busy}
            onWithdraw={(tier) => withdrawStone(characterId, tier, 1)}
            onDone={() => {
              closeModal()
              onWithdrawLandedInInventory?.()
            }}
          />
        </BankActionModal>
      )}

      {selected?.kind === 'gearSlot' && (
        <BankActionModal
          title={`${formatGearSlotLabel(selected.slotType)} Points`}
          subtitle="Spend points for one fresh item at a chosen tier."
          onClose={closeModal}
        >
          <GearSlotPanel
            slotType={selected.slotType}
            points={gearCompositionPoints[selected.slotType]}
            busy={busy}
            onWithdraw={(templateId, tier) => withdrawGearComposition(characterId, templateId, tier)}
            onDone={() => {
              closeModal()
              onWithdrawLandedInInventory?.()
            }}
          />
        </BankActionModal>
      )}
    </div>
  )
}

// Icon-based redesign (2026-08-07, confirmed with the user) — Comets/Fallen
// Stars/Composition Stones now show as an icon with the quantity
// underneath, replacing the plain text label, matching this game's usual
// tile convention elsewhere (Inventory, Bank Storage, Loot Holding). Gold
// and the two points pools (Composition Points, per-slot Gear Points) stay
// label-only — not currencies in the same "you can hold a physical unit of
// this" sense, and neither has a dedicated icon.
function Square({
  label,
  value,
  icon,
  iconSrc,
  cornerLabel,
  accentColor,
  selected,
  onClick,
}: {
  label: string
  value: number
  icon?: string
  iconSrc?: string
  cornerLabel?: string
  accentColor?: string
  selected: boolean
  onClick: () => void
}) {
  const hasIcon = Boolean(icon || iconSrc)
  const borderColor = selected ? undefined : accentColor
  const backgroundColor = selected ? undefined : accentColor ? `${accentColor}14` : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      title={hasIcon ? label : undefined}
      style={hasIcon ? { borderColor, backgroundColor } : undefined}
      className={`relative flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border p-2 text-center ${
        selected
          ? 'border-sky-500 bg-sky-500/10'
          : hasIcon
            ? 'hover:brightness-125'
            : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
      }`}
    >
      {cornerLabel && (
        <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1 text-[9px] font-semibold text-slate-300">{cornerLabel}</span>
      )}
      {hasIcon ? (
        <>
          {iconSrc ? <img src={iconSrc} alt="" className="h-7 w-7 object-contain" /> : <span className="text-2xl leading-none">{icon}</span>}
          <span className="text-base font-semibold text-slate-100">{value.toLocaleString()}</span>
        </>
      ) : (
        <>
          <span className="text-[11px] font-medium leading-tight text-slate-300">{label}</span>
          <span className="text-lg font-semibold text-slate-100">{value.toLocaleString()}</span>
        </>
      )}
    </button>
  )
}

// Gold has no Inventory tile at all, so this is Gold's only interaction —
// both directions stay, unlike the other squares below (which only ever
// withdraw, since deposit for those now happens via the per-item Bank/
// Deposit popover in Inventory).
//
// Redesigned (2026-08-07, confirmed with the user) — a single-unit slider
// (0-BANK_ACTION_SLIDER_CAP, clamped further by whatever's actually
// available) replaces the old plain number input with its native up/down
// spinner arrows. Withdrawing Comets/Fallen Stars auto-bundles into Scrolls
// server-side now (see transfer_currency's SQL) — this panel just previews
// what that split will look like before confirming, purely informational.
function CurrencyPanel({
  currencyId,
  label,
  wallet,
  bank,
  iconSrc,
  busy,
  onDeposit,
  onWithdraw,
  onDone,
  onLanded,
}: {
  currencyId: CurrencyId
  label: string
  wallet: number
  bank: number
  iconSrc?: string
  busy: boolean
  onDeposit: (amount: number) => Promise<{ ok: boolean; error?: string; max_withdrawable?: number }>
  onWithdraw: (amount: number) => Promise<{ ok: boolean; error?: string; max_withdrawable?: number }>
  onDone: () => void
  // Called (in addition to onDone) after a successful WITHDRAW of a
  // currency that actually lands as a tile in the Character Inventory
  // (Comets/Fallen Stars — Gold has no tile, so this is skipped for Gold).
  onLanded?: () => void
}) {
  const showGainToast = useGainToastStore((state) => state.show)
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const available = mode === 'deposit' ? wallet : bank
  const sliderMax = Math.max(0, Math.min(BANK_ACTION_SLIDER_CAP, available))
  const validAmount = amount > 0

  const bundlesIntoScrolls = currencyId !== 'gold' && mode === 'withdraw' && amount >= 10
  const scrollsForAmount = Math.floor(amount / 10)
  const remainderForAmount = amount % 10

  const handleConfirm = async () => {
    if (!validAmount) return
    setError(null)
    const result = mode === 'deposit' ? await onDeposit(amount) : await onWithdraw(amount)
    if (!result.ok) {
      setError(
        result.error === 'not_enough_balance'
          ? "You don't have that much."
          : result.error === 'not_enough_room'
            ? `Not enough Inventory space${
                typeof result.max_withdrawable === 'number'
                  ? ` (only ${result.max_withdrawable} unit${result.max_withdrawable === 1 ? '' : 's'} fit)`
                  : ''
              }.`
            : 'Something went wrong.',
      )
      return
    }

    // Bundled withdrawals (2026-08-07) land as Scroll tiles, not loose ones —
    // spelled out explicitly in the toast itself (reported by a user who
    // withdrew 40 Comets, got 4 Comet Scrolls as designed, and had no way to
    // tell that's what happened from a toast that just said "+40 Comet").
    const landsAsScrolls = mode === 'withdraw' && bundlesIntoScrolls
    showGainToast({
      label: landsAsScrolls
        ? `${label} Withdrawn — as ${scrollsForAmount} Scroll${scrollsForAmount === 1 ? '' : 's'}${
            remainderForAmount > 0 ? ` + ${remainderForAmount} loose` : ''
          }, in your Inventory`
        : `${label} ${mode === 'deposit' ? 'Banked' : 'Withdrawn — in your Inventory'}`,
      amount,
      iconSrc,
      icon: iconSrc ? undefined : '💰',
      color: mode === 'deposit' ? '#38bdf8' : '#fbbf24',
    })
    onDone()
    if (mode === 'withdraw' && currencyId !== 'gold') {
      onLanded?.()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMode('deposit')
            setAmount(0)
            setError(null)
          }}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            mode === 'deposit' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Deposit
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('withdraw')
            setAmount(0)
            setError(null)
          }}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            mode === 'withdraw' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Withdraw
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>Wallet: {wallet.toLocaleString()}</span>
        <span>Bank: {bank.toLocaleString()}</span>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Amount</span>
          <span className="text-lg font-semibold text-slate-100">{amount.toLocaleString()}</span>
        </div>
        <input
          type="range"
          min={0}
          max={sliderMax}
          value={Math.min(amount, sliderMax)}
          disabled={sliderMax === 0}
          onChange={(event) => setAmount(Number(event.target.value))}
          className="mt-2 w-full accent-sky-500 disabled:opacity-40"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-600">
          <span>0</span>
          <span>{sliderMax.toLocaleString()}</span>
        </div>

        {bundlesIntoScrolls && (
          <p className="mt-2 text-[11px] text-slate-500">
            → lands in your Character Inventory as {scrollsForAmount > 0 && `${scrollsForAmount} Scroll${scrollsForAmount === 1 ? '' : 's'}`}
            {scrollsForAmount > 0 && remainderForAmount > 0 && ' + '}
            {remainderForAmount > 0 && `${remainderForAmount} loose`}
            {' '}(saves space vs. {amount} loose tiles)
          </p>
        )}
        {mode === 'withdraw' && currencyId !== 'gold' && !bundlesIntoScrolls && amount > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">→ lands in your Character Inventory as {amount} loose tile{amount === 1 ? '' : 's'}.</p>
        )}
      </div>

      <button
        type="button"
        disabled={busy || !validAmount}
        onClick={() => void handleConfirm()}
        className="w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Working…' : `Confirm ${mode === 'deposit' ? 'Deposit' : 'Withdraw'}`}
      </button>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// Deposit for a physically-banked stone tier happens via the per-tile Bank
// popover in Inventory now (bank_stone_item) — this panel only withdraws.
// Single-item only (2026-08-07, confirmed with the user: "withdrawing
// composition stones or gear will not have this option [bundling] and will
// be single items only") — no amount slider/input, just a plain "Withdraw
// 1" action, mirroring gear's own always-one-at-a-time withdrawal.
function StoneTierPanel({
  tier,
  owned,
  busy,
  onWithdraw,
  onDone,
}: {
  tier: number
  owned: number
  busy: boolean
  onWithdraw: () => Promise<{ ok: boolean; error?: string }>
  onDone: () => void
}) {
  const showGainToast = useGainToastStore((state) => state.show)
  const [error, setError] = useState<string | null>(null)

  const handleWithdraw = async () => {
    setError(null)
    const result = await onWithdraw()
    if (!result.ok) {
      setError("You don't have one banked.")
      return
    }

    showGainToast({ label: `Tier ${tier} Stone`, amount: 1, icon: '🔷', color: MATERIAL_COLOR })
    onDone()
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{owned.toLocaleString()} in Storage — deposit more from Inventory's Bank button.</p>
      <button
        type="button"
        disabled={busy || owned <= 0}
        onClick={() => void handleWithdraw()}
        className="w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Working…' : 'Withdraw 1'}
      </button>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// The stone-tier-conversion currency (transfer_stone) — spend points for a
// stone at a chosen tier. Gaining points happens via the per-stone-tile
// "Bank" button in Inventory now, not from here. Single-item only, same
// reasoning as StoneTierPanel above — pick a tier, withdraw exactly one.
function CompositionPointsPanel({
  points,
  busy,
  onWithdraw,
  onDone,
}: {
  points: number
  busy: boolean
  onWithdraw: (tier: number) => Promise<{ ok: boolean; error?: string }>
  onDone: () => void
}) {
  const showGainToast = useGainToastStore((state) => state.show)
  const [tier, setTier] = useState<number>(COMPOSITION_STONE_TIERS[0])
  const [error, setError] = useState<string | null>(null)

  const cost = compositionPointValue(tier)
  const canAfford = points >= cost

  const handleWithdraw = async () => {
    setError(null)
    const result = await onWithdraw(tier)
    if (!result.ok) {
      setError("You don't have enough Composition Points.")
      return
    }

    showGainToast({ label: `Tier ${tier} Stone`, amount: 1, icon: '🔷', color: MATERIAL_COLOR })
    onDone()
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Spend points for one stone at a chosen tier — gain points by Banking a stone from Inventory instead.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {COMPOSITION_STONE_TIERS.map((stoneTier) => (
          <button
            key={stoneTier}
            type="button"
            onClick={() => setTier(stoneTier)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
              tier === stoneTier ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            +{stoneTier} ({compositionPointValue(stoneTier)} pts)
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={busy || !canAfford}
        onClick={() => void handleWithdraw()}
        className="w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Working…' : `Withdraw 1 (${cost} pts)`}
      </button>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// Unchanged from the old GearCompositionRow — a per-slot-type pool with no
// per-template memory, so the player picks any eligible template of the
// matching slot_type before choosing a tier to pay for.
function GearSlotPanel({
  slotType,
  points,
  busy,
  onWithdraw,
  onDone,
}: {
  slotType: GearSlotType
  points: number
  busy: boolean
  onWithdraw: (templateId: string, tier: number) => Promise<{ ok: boolean; error?: string; item?: unknown }>
  onDone: () => void
}) {
  const templates = useItemTemplatesStore((state) => state.templates)
  const classId = useCharacterStore((state) => state.selectedClassId)
  const showGainToast = useGainToastStore((state) => state.show)

  const [templateId, setTemplateId] = useState('')
  const [tier, setTier] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const eligibleTemplates = templates
    .filter((template) => template.slot_type === slotType && (template.required_class === null || template.required_class === classId))
    .sort((a, b) => a.required_level - b.required_level)

  const cost = compositionPointValue(tier)

  const handleWithdraw = async () => {
    setError(null)
    if (!templateId) return
    const result = await onWithdraw(templateId, tier)
    if (!result.ok) {
      setError(
        result.error === 'inventory_full'
          ? 'Inventory is full.'
          : result.error === 'not_enough_points'
            ? "You don't have enough points for this slot."
            : "Couldn't withdraw that item.",
      )
      return
    }

    const templateName = eligibleTemplates.find((template) => template.id === templateId)?.name ?? 'Item'
    showGainToast({ label: templateName, amount: 1, icon: '🎁', color: '#a855f7' })
    onDone()
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Spend points for a fresh item at a chosen tier — gain points by Banking a composed {formatGearSlotLabel(slotType).toLowerCase()}{' '}
        from Inventory instead.
      </p>

      {eligibleTemplates.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No {formatGearSlotLabel(slotType).toLowerCase()} items available for your class.</p>
      ) : (
        <>
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            <option value="">Choose an item…</option>
            {eligibleTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} (Lv {template.required_level})
              </option>
            ))}
          </select>

          <div className="mt-2 flex flex-wrap gap-1.5">
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
                  tier === stoneTier ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
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
            className="mt-2 w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Withdraw{cost > 0 ? ` (${cost} pts)` : ''}
          </button>
        </>
      )}

      {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}
    </div>
  )
}
