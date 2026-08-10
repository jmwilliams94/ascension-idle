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
  getStoneIconSrc,
} from '../game/items/forgeCosts'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useBankStore } from '../game/items/useBankStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { GEM_TYPE_ORDER, GEM_TIERS, GEM_TYPES, gemStorageKey, getGemIconSrc, getGemTierColor, formatGemTierLabel, type GemTier, type GemTypeId } from '../game/items/gemTypes'
// The per-action floating "+gained" toast (2026-08-07, confirmed with the
// user) — fired for every deliberate Bank deposit/withdraw here, mirroring
// the same call ShopPanel/SalvagePanel's own sell/salvage flows make.
import { useGainToastStore } from '../game/hud/useGainToastStore'

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

type SelectedSquare = { kind: 'currency'; id: CurrencyId } | { kind: 'compositionPoints' } | { kind: 'gearPoints' } | { kind: 'gems' } | null

function squareKey(square: NonNullable<SelectedSquare>): string {
  switch (square.kind) {
    case 'currency':
      return `currency:${square.id}`
    case 'compositionPoints':
      return 'compositionPoints'
    case 'gearPoints':
      return 'gearPoints'
    case 'gems':
      return 'gems'
  }
}

// Bank tab rework (2026-08-03, confirmed with the user) — replaces
// BankedCard's row-based layout (CurrencyRow/StonesRow/GearCompositionRow)
// with a grid of simple squares: label on top, quantity underneath, nothing
// more. Always rendered regardless of the Inventory/Storage toggle in
// BankPanel — these are account-wide totals, independent of which side
// the main grid is currently showing.
//
// Simplified further 2026-08-07 (confirmed with the user) — the individual
// "Tier N Stone" physical-storage squares (composition_stones_banked) and
// the six separate per-slot-type "<Slot> Points" squares are gone. Physical
// stone banking (the "Deposit" side of a stone tile's Bank-tab popover) is
// retired entirely — Composition Points (a single square, spend-to-withdraw-
// any-tier via a slider) is now the only way stones move through the Bank.
// The six gear pools still exist server-side exactly as before (still
// per-slot-type, still non-fungible across slot types) — "Gear Points" is
// just one entry point now, a category square with no number of its own
// that opens a slot-type picker before landing in the same
// pick-a-tier-with-a-slider withdraw flow Composition Points uses.
//
// Each square shows a *different* pool than the physical Bank Storage grid
// (BankGrid) — these are all liquidated/converted balances (currency
// Bank balances and the two points-conversion pools), not physical item
// tiles. Depositing into most of these now happens via the per-item "Bank"
// popover in the Inventory-side grid (InventoryPanel's enableBankDeposit)
// instead of from here — clicking a square only ever reveals a Withdraw
// control, except currency (Gold has no Inventory tile at all, so its own
// square is the only place to move it either direction).
export default function BankSquares({
  characterId,
  onWithdrawLandedInInventory,
}: {
  characterId: string
  // Called after a withdrawal that actually adds something to the
  // Character Inventory grid (Comets/Fallen Stars, a Composition-Points
  // stone, or a Gear-Points item) — lets BankPanel auto-switch its own
  // toggle to the Character view so the result is immediately visible,
  // rather than staying on "Account" (which never shows any of these) and
  // looking like nothing happened.
  onWithdrawLandedInInventory?: () => void
}) {
  const gold = useProgressionStore((state) => state.gold)
  const comets = useCurrencyStore((state) => state.comets)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const bankGold = usePlayerRecordStore((state) => state.bankGold)
  const bankComets = usePlayerRecordStore((state) => state.bankComets)
  const bankFallenStars = usePlayerRecordStore((state) => state.bankFallenStars)
  const bankPoints = usePlayerRecordStore((state) => state.bankPoints)
  const gearCompositionPoints = usePlayerRecordStore((state) => state.gearCompositionPoints)
  const gemsBanked = usePlayerRecordStore((state) => state.gemsBanked)

  const busy = useBankStore((state) => state.busy)
  const depositCurrency = useBankStore((state) => state.depositCurrency)
  const withdrawCurrency = useBankStore((state) => state.withdrawCurrency)
  const withdrawStone = useBankStore((state) => state.withdrawStone)
  const withdrawGearComposition = useBankStore((state) => state.withdrawGearComposition)
  const withdrawGem = useBankStore((state) => state.withdrawGem)

  const [selected, setSelected] = useState<SelectedSquare>(null)

  const toggle = (square: NonNullable<SelectedSquare>) => {
    setSelected((current) => (current && squareKey(current) === squareKey(square) ? null : square))
  }

  const walletFor = (id: CurrencyId) => (id === 'gold' ? gold : id === 'comets' ? comets : fallenStars)
  const bankFor = (id: CurrencyId) => (id === 'gold' ? bankGold : id === 'comets' ? bankComets : bankFallenStars)
  const totalGemsBanked = Object.values(gemsBanked).reduce<number>((sum, count) => sum + (count ?? 0), 0)

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
        <Square
          label="Composition Points"
          value={bankPoints}
          selected={selected?.kind === 'compositionPoints'}
          onClick={() => toggle({ kind: 'compositionPoints' })}
        />
        <Square label="Gear Points" selected={selected?.kind === 'gearPoints'} onClick={() => toggle({ kind: 'gearPoints' })} />
        <Square
          label="Gems"
          value={totalGemsBanked}
          icon="💎"
          selected={selected?.kind === 'gems'}
          onClick={() => toggle({ kind: 'gems' })}
        />
      </div>

      {selected?.kind === 'currency' && selected.id === 'gold' && (
        <BankActionModal title="Gold" subtitle="Move currency between your Wallet and the account Bank." onClose={closeModal}>
          <CurrencyPanel
            label="Gold"
            wallet={walletFor('gold')}
            bank={bankFor('gold')}
            busy={busy}
            onDeposit={(amount) => depositCurrency(characterId, 'gold', amount)}
            onWithdraw={(amount) => withdrawCurrency(characterId, 'gold', amount)}
            onDone={closeModal}
          />
        </BankActionModal>
      )}

      {selected?.kind === 'currency' && selected.id !== 'gold' && (
        <BankActionModal
          title={CURRENCIES.find((c) => c.id === selected.id)!.label}
          subtitle="Withdraw from the account Bank into your Inventory, as Individual units or Scrolls."
          onClose={closeModal}
        >
          <CometFallenStarPanel
            label={CURRENCIES.find((c) => c.id === selected.id)!.label}
            bank={bankFor(selected.id)}
            iconSrc={CURRENCY_ICON_SRC[selected.id]}
            busy={busy}
            onWithdraw={(amount, forceIndividual) => withdrawCurrency(characterId, selected.id as 'comets' | 'fallen_stars', amount, forceIndividual)}
            onDone={closeModal}
            onLanded={onWithdrawLandedInInventory}
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

      {selected?.kind === 'gearPoints' && (
        <BankActionModal title="Gear Points" subtitle="Pick a gear type, then spend its points for one fresh item." onClose={closeModal}>
          <GearPointsPanel
            gearCompositionPoints={gearCompositionPoints}
            busy={busy}
            onWithdraw={(_slotType, templateId, tier) => withdrawGearComposition(characterId, templateId, tier)}
            onDone={() => {
              closeModal()
              onWithdrawLandedInInventory?.()
            }}
          />
        </BankActionModal>
      )}

      {selected?.kind === 'gems' && (
        <BankActionModal
          title="Gems"
          subtitle="Withdraw a banked gem back into your Inventory. Deposit a gem via its own Bank/Bank All button in Inventory."
          onClose={closeModal}
        >
          <GemsPanel
            gemsBanked={gemsBanked}
            busy={busy}
            onWithdraw={(gemId, tier) => withdrawGem(characterId, gemId, tier, 1)}
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
// Stars show as an icon with the quantity underneath, replacing the plain
// text label, matching this game's usual tile convention elsewhere
// (Inventory, Bank Storage, Loot Holding). Gold and the two points pools
// (Composition Points, Gear Points) stay label-only — not currencies in the
// same "you can hold a physical unit of this" sense, and neither has a
// dedicated icon. `value` is optional now (Gear Points has none of its own —
// it's a category button, not a balance) — omitting it just skips the
// number line.
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
  value?: number
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
          {value !== undefined && <span className="text-base font-semibold text-slate-100">{value.toLocaleString()}</span>}
        </>
      ) : (
        <>
          <span className="text-[11px] font-medium leading-tight text-slate-300">{label}</span>
          {value !== undefined && <span className="text-lg font-semibold text-slate-100">{value.toLocaleString()}</span>}
        </>
      )}
    </button>
  )
}

// Gold has no Inventory tile at all, so this Deposit/Withdraw panel is
// Gold's only interaction with the Account Bank (Comets/Fallen Stars use
// their own withdraw-only CometFallenStarPanel below instead, see the
// 2026-08-14 rework). A single-unit slider (0-BANK_ACTION_SLIDER_CAP,
// clamped further by whatever's actually available) replaces a plain number
// input with its native up/down spinner arrows.
const BANK_ACTION_SLIDER_CAP = 40

function CurrencyPanel({
  label,
  wallet,
  bank,
  busy,
  onDeposit,
  onWithdraw,
  onDone,
}: {
  label: string
  wallet: number
  bank: number
  busy: boolean
  onDeposit: (amount: number) => Promise<{ ok: boolean; error?: string }>
  onWithdraw: (amount: number) => Promise<{ ok: boolean; error?: string }>
  onDone: () => void
}) {
  const showGainToast = useGainToastStore((state) => state.show)
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const available = mode === 'deposit' ? wallet : bank
  const sliderMax = Math.max(0, Math.min(BANK_ACTION_SLIDER_CAP, available))
  const validAmount = amount > 0

  const handleConfirm = async () => {
    if (!validAmount) return
    setError(null)
    const result = mode === 'deposit' ? await onDeposit(amount) : await onWithdraw(amount)
    if (!result.ok) {
      setError(result.error === 'not_enough_balance' ? "You don't have that much." : 'Something went wrong.')
      return
    }

    showGainToast({
      label: `${label} ${mode === 'deposit' ? 'Banked' : 'Withdrawn'}`,
      amount,
      icon: '💰',
      color: mode === 'deposit' ? '#38bdf8' : '#fbbf24',
    })
    onDone()
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

// Comets/Fallen Stars-only Account Bank withdraw panel (2026-08-14,
// requested by the user) — replaces the shared Deposit/Withdraw
// CurrencyPanel above for these two currencies specifically. Deposit still
// exists for them, just from the per-tile "Bank"/"Bank All" popover in
// Inventory instead of from here. Individual/Scroll is a genuine mode
// switch, not a preview: Individual withdraws exactly the requested number
// of loose units (force_individual on transfer_currency, see the
// 20260814020000 migration); Scroll withdraws a chosen number of Scrolls by
// requesting an exact multiple of 10, which the existing bundling logic
// already turns into pure Scrolls with a zero remainder.
function CometFallenStarPanel({
  label,
  bank,
  iconSrc,
  busy,
  onWithdraw,
  onDone,
  onLanded,
}: {
  label: string
  bank: number
  iconSrc?: string
  busy: boolean
  onWithdraw: (amount: number, forceIndividual: boolean) => Promise<{ ok: boolean; error?: string; max_withdrawable?: number }>
  onDone: () => void
  onLanded?: () => void
}) {
  const showGainToast = useGainToastStore((state) => state.show)
  const [mode, setMode] = useState<'individual' | 'scroll'>('individual')
  // Units in Individual mode, Scroll count in Scroll mode.
  const [amount, setAmount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const sliderMax =
    mode === 'individual'
      ? Math.max(0, Math.min(BANK_ACTION_SLIDER_CAP, bank))
      : Math.max(0, Math.min(BANK_ACTION_SLIDER_CAP, Math.floor(bank / 10)))
  const validAmount = amount > 0

  const setModeAndReset = (nextMode: 'individual' | 'scroll') => {
    setMode(nextMode)
    setAmount(0)
    setError(null)
  }

  const handleConfirm = async () => {
    if (!validAmount) return
    setError(null)
    const requestAmount = mode === 'scroll' ? amount * 10 : amount
    const result = await onWithdraw(requestAmount, mode === 'individual')
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

    showGainToast({
      label:
        mode === 'scroll'
          ? `${label} Withdrawn — as ${amount} Scroll${amount === 1 ? '' : 's'}, in your Inventory`
          : `${label} Withdrawn — in your Inventory`,
      amount: requestAmount,
      iconSrc,
      icon: iconSrc ? undefined : '💰',
      color: '#fbbf24',
    })
    onDone()
    onLanded?.()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setModeAndReset('individual')}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            mode === 'individual' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Individual
        </button>
        <button
          type="button"
          onClick={() => setModeAndReset('scroll')}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            mode === 'scroll' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Scroll
        </button>
      </div>

      <p className="text-[11px] text-slate-500">Bank: {bank.toLocaleString()}</p>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{mode === 'scroll' ? 'Scrolls' : 'Amount'}</span>
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

        {mode === 'individual' && amount > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            → lands in your Character Inventory as {amount} loose tile{amount === 1 ? '' : 's'}.
          </p>
        )}
        {mode === 'scroll' && amount > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            → lands in your Character Inventory as {amount} Scroll{amount === 1 ? '' : 's'} ({(amount * 10).toLocaleString()} {label.toLowerCase()}).
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={busy || !validAmount}
        onClick={() => void handleConfirm()}
        className="w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Working…' : 'Withdraw'}
      </button>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}

// Shared tier-picking slider (2026-08-07, confirmed with the user — "use the
// slider to select which +n stone you want to withdraw") — used by both
// CompositionPointsPanel and GearPointsPanel's per-slot-type step below.
// minTier is 1 for Composition Points (no "Normal stone" concept) and 0 for
// Gear Points (a Normal/free item is a valid pick there).
function TierSlider({ tier, setTier, minTier = 1 }: { tier: number; setTier: (tier: number) => void; minTier?: number }) {
  const maxTier = COMPOSITION_STONE_TIERS[COMPOSITION_STONE_TIERS.length - 1]
  const cost = compositionPointValue(tier)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Tier</span>
        <span className="text-lg font-semibold text-slate-100">{tier <= 0 ? 'Normal' : `+${tier}`}</span>
      </div>
      <input
        type="range"
        min={minTier}
        max={maxTier}
        value={tier}
        onChange={(event) => setTier(Number(event.target.value))}
        className="mt-2 w-full accent-sky-500"
      />
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>{minTier <= 0 ? 'Normal' : `+${minTier}`}</span>
        <span>+{maxTier}</span>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{cost > 0 ? `${cost.toLocaleString()} pts` : 'Free'}</p>
    </div>
  )
}

// The stone-tier-conversion currency (transfer_stone) — spend points for a
// stone at a chosen tier. Gaining points happens via the per-stone-tile
// "Bank" button in Inventory now, not from here.
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

    showGainToast({ label: `Tier ${tier} Stone`, amount: 1, icon: '🔷', iconSrc: getStoneIconSrc(tier), color: MATERIAL_COLOR })
    onDone()
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {points.toLocaleString()} points available — gain more by Banking a stone from Inventory.
      </p>
      <TierSlider tier={tier} setTier={setTier} />
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

// Gear Points (2026-08-07 redesign) — a category square, not a balance
// (see Square's optional value above). Stage 1 picks which of the six
// per-slot-type pools to spend from; stage 2 reuses the exact same
// pick-a-tier-with-a-slider interaction Composition Points uses, plus a
// template picker (a points pool has to buy back a specific item, unlike a
// stone which has no template of its own).
function GearPointsPanel({
  gearCompositionPoints,
  busy,
  onWithdraw,
  onDone,
}: {
  gearCompositionPoints: Record<GearSlotType, number>
  busy: boolean
  onWithdraw: (slotType: GearSlotType, templateId: string, tier: number) => Promise<{ ok: boolean; error?: string; item?: unknown }>
  onDone: () => void
}) {
  const [slotType, setSlotType] = useState<GearSlotType | null>(null)

  if (!slotType) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">Choose a gear type to spend its points pool.</p>
        <div className="grid grid-cols-2 gap-1.5">
          {GEAR_SLOT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSlotType(type)}
              className="rounded-lg border border-slate-700 px-2.5 py-2 text-left text-xs font-medium text-slate-300 hover:border-slate-500"
            >
              <span className="block">{formatGearSlotLabel(type)}</span>
              <span className="block text-[10px] font-normal text-slate-500">{gearCompositionPoints[type].toLocaleString()} pts</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <GearSlotWithdrawPanel
      slotType={slotType}
      points={gearCompositionPoints[slotType]}
      busy={busy}
      onBack={() => setSlotType(null)}
      onWithdraw={(templateId, tier) => onWithdraw(slotType, templateId, tier)}
      onDone={onDone}
    />
  )
}

// Stage 2 of GearPointsPanel above — a per-slot-type pool with no
// per-template memory, so the player picks any eligible template of the
// matching slot_type before choosing a tier (via the shared TierSlider) to
// pay for.
function GearSlotWithdrawPanel({
  slotType,
  points,
  busy,
  onBack,
  onWithdraw,
  onDone,
}: {
  slotType: GearSlotType
  points: number
  busy: boolean
  onBack: () => void
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
      <button type="button" onClick={onBack} className="text-[11px] text-slate-500 hover:text-slate-300">
        ‹ Back to gear types
      </button>

      <p className="text-xs text-slate-500">
        {points.toLocaleString()} {formatGearSlotLabel(slotType).toLowerCase()} points available — gain more by Banking a composed{' '}
        {formatGearSlotLabel(slotType).toLowerCase()} from Inventory.
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

          <TierSlider tier={tier} setTier={setTier} minTier={0} />

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

// Gems (2026-08-09) — withdraw-only, same convention as Composition/Gear
// Points above (deposit happens via the per-gem-tile Bank/Bank All button in
// Inventory instead). Two dimensions to pick (gem type x tier) rather than
// a single tier slider, since gems have no shared "points" pool to spend —
// each gem type+tier combo is its own fully independent banked count.
function GemsPanel({
  gemsBanked,
  busy,
  onWithdraw,
  onDone,
}: {
  gemsBanked: Partial<Record<string, number>>
  busy: boolean
  onWithdraw: (gemId: GemTypeId, tier: GemTier) => Promise<{ ok: boolean; error?: string }>
  onDone: () => void
}) {
  const showGainToast = useGainToastStore((state) => state.show)
  const [gemId, setGemId] = useState<GemTypeId>(GEM_TYPE_ORDER[0])
  const [tier, setTier] = useState<GemTier>(GEM_TIERS[0])
  const [error, setError] = useState<string | null>(null)

  const owned = gemsBanked[gemStorageKey(gemId, tier)] ?? 0
  const color = getGemTierColor(tier)

  const handleWithdraw = async () => {
    setError(null)
    const result = await onWithdraw(gemId, tier)
    if (!result.ok) {
      setError(result.error === 'not_enough_room' ? 'Not enough Inventory space.' : "You don't have that gem banked.")
      return
    }

    showGainToast({ label: `${formatGemTierLabel(tier)} ${GEM_TYPES[gemId].displayName}`, amount: 1, iconSrc: getGemIconSrc(gemId, tier), color })
    onDone()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {GEM_TYPE_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setGemId(id)}
            className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium ${
              gemId === id ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {GEM_TYPES[id].displayName.replace(' Gem', '')}
          </button>
        ))}
      </div>

      {/* One tile per tier, quantity shown underneath each (2026-08-14,
          requested by the user) — replaces the old tier-button row + single
          preview box, so all three counts for the selected gem type are
          visible at once instead of only the currently-selected tier's.
          Clicking a tile both selects that tier and stays the withdraw
          target below. */}
      <div className="grid grid-cols-3 gap-1.5">
        {GEM_TIERS.map((t) => {
          const tierColor = getGemTierColor(t)
          const tierOwned = gemsBanked[gemStorageKey(gemId, t)] ?? 0
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 ${
                tier === t ? 'border-sky-500 bg-sky-500/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
              }`}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 p-1"
                style={{ borderColor: tierColor, backgroundColor: `${tierColor}22` }}
              >
                <img src={getGemIconSrc(gemId, t)} alt="" className="h-full w-full object-contain" />
              </div>
              <span className="text-[10px] font-medium text-slate-400">{formatGemTierLabel(t)}</span>
              <span className="text-sm font-semibold text-slate-100">{tierOwned.toLocaleString()}</span>
            </button>
          )
        })}
      </div>

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
