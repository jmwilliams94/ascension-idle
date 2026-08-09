import { useEffect, useRef, useState } from 'react'
import EnchantGemSlot from './EnchantGemSlot'
import ForgeTwoColumnLayout from './ForgeTwoColumnLayout'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import { DragDropProvider } from './dragDrop'
import InventoryPanel from './InventoryPanel'
import { ENCHANT_HP_COLOR, ENCHANT_HP_RANGE_BY_TIER, parseGemDragId, type GemTier, type GemTypeId } from '../game/items/gemTypes'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

// How long the cycling-number roll animation plays before snapping to the
// real, server-rolled value (per the user's "cycling number animation ...
// which after a second or two animates the rolled enchanted hp"). The RPC
// call runs in parallel with this timer — Promise.all below waits for
// whichever finishes last, so a slow network doesn't cut the animation short.
const ROLL_ANIMATION_MS = 1500
const ROLL_TICK_MS = 60

function describeEnchantFailure(error?: string): string {
  switch (error) {
    case 'not_enough_gems':
      return "You don't have that gem anymore."
    case 'invalid_gem':
    case 'invalid_tier':
      return "That gem can't be used here."
    case 'not_owner':
    case 'item_not_found':
      return "Couldn't find that item."
    default:
      return 'Something went wrong.'
  }
}

interface StagedGem {
  dragId: string
  gemId: GemTypeId
  tier: GemTier
}

interface EnchantressPanelProps {
  onBack: () => void
}

// Enchantress (2026-08-13, new mechanic) — consume any gem, of any type, at
// a given tier to roll a flat HP bonus onto a gear item, somewhere within
// that tier's range (Normal 1-59, Tempered 100-159, Ascended 200-255 — see
// gemCatalog.ts's ENCHANT_HP_RANGE_BY_TIER). One enchant slot per item,
// overwrite-only: a new roll only replaces the stored value if it beats the
// item's existing enchant, the gem is consumed either way (see
// enchant_item_hp's SQL). The roll itself is always decided server-side —
// the cycling number here is a pure client-side animation that lands on
// whatever the RPC actually returned, never a locally-guessed value.
export default function EnchantressPanel({ onBack }: EnchantressPanelProps) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const busy = useForgeStore((state) => state.busy)
  const enchantItemHp = useForgeStore((state) => state.enchantItemHp)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [stagedGem, setStagedGem] = useState<StagedGem | null>(null)
  const [rolling, setRolling] = useState(false)
  const [rollDisplay, setRollDisplay] = useState<number | null>(null)
  const [resultMessage, setResultMessage] = useState<{ rolled: number; applied: boolean } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const cycleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    if (cycleIntervalRef.current) {
      clearInterval(cycleIntervalRef.current)
    }
  }, [])

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null
  const currentEnchantHp = selectedItem?.enchant?.hp ?? 0

  const handleDropItemId = (itemId: string) => {
    if (!items.some((item) => item.id === itemId) || rolling) {
      return
    }
    setSelectedItemId(itemId)
    setResultMessage(null)
    setErrorMessage(null)
  }

  const handleRemoveItem = () => {
    if (rolling) {
      return
    }
    setSelectedItemId(null)
    setResultMessage(null)
    setErrorMessage(null)
  }

  const handleDropGem = (id: string) => {
    if (rolling) {
      return
    }
    const parsed = parseGemDragId(id)
    if (!parsed) {
      return
    }
    setStagedGem({ dragId: id, gemId: parsed.gemId, tier: parsed.tier })
    setResultMessage(null)
    setErrorMessage(null)
  }

  const handleRemoveGem = () => {
    if (rolling) {
      return
    }
    setStagedGem(null)
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleDropItemId(id)
      return
    }
    if (overTarget === 'gem') {
      handleDropGem(id)
    }
  }

  const handleEnchant = async () => {
    if (!selectedItem || !stagedGem || rolling) {
      return
    }

    setRolling(true)
    setResultMessage(null)
    setErrorMessage(null)

    const range = ENCHANT_HP_RANGE_BY_TIER[stagedGem.tier]
    cycleIntervalRef.current = setInterval(() => {
      setRollDisplay(range.min + Math.floor(Math.random() * (range.max - range.min + 1)))
    }, ROLL_TICK_MS)

    const [result] = await Promise.all([
      enchantItemHp(selectedItem.id, stagedGem.gemId, stagedGem.tier),
      new Promise((resolve) => setTimeout(resolve, ROLL_ANIMATION_MS)),
    ])

    if (cycleIntervalRef.current) {
      clearInterval(cycleIntervalRef.current)
      cycleIntervalRef.current = null
    }
    setRolling(false)
    setStagedGem(null)

    if (!result.ok || typeof result.rolled !== 'number') {
      setErrorMessage(describeEnchantFailure(result.error))
      setRollDisplay(null)
      return
    }

    setRollDisplay(result.rolled)
    setResultMessage({ rolled: result.rolled, applied: Boolean(result.applied) })
  }

  return (
    <DragDropProvider>
      <ForgeTwoColumnLayout
        title="Enchantress"
        onBack={onBack}
        inventory={
          <InventoryPanel columns={5} reservedItemIds={selectedItemId ? [selectedItemId] : []} onTileDrop={handleTileDrop} />
        }
      >
        <p className="max-w-sm text-center text-[11px] text-slate-500">
          Consume a Normal, Tempered, or Ascended gem to roll a flat HP bonus for a piece of gear. Only a higher roll replaces the
          item's existing bonus — the gem is spent either way.
        </p>

        <div className="flex items-start justify-center gap-6">
          <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemoveItem} />
          <EnchantGemSlot gem={stagedGem} onRemove={handleRemoveGem} />
        </div>

        {selectedItem && (
          <p className="text-center text-[11px] text-slate-500">
            Current Enchanted HP: <span style={{ color: ENCHANT_HP_COLOR }}>{currentEnchantHp}</span>
          </p>
        )}

        {rollDisplay !== null && (
          <div className="flex flex-col items-center gap-1">
            <p
              className="text-5xl font-extrabold tabular-nums"
              style={{ color: rolling ? '#e2e8f0' : ENCHANT_HP_COLOR }}
            >
              {rollDisplay}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{rolling ? 'Rolling…' : 'HP'}</p>
          </div>
        )}

        {resultMessage && (
          <div
            className={`w-full max-w-xs rounded-xl border p-2.5 text-center text-xs ${
              resultMessage.applied ? 'forge-success-flash border-emerald-600 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900/60 text-slate-400'
            }`}
          >
            {resultMessage.applied
              ? `New Enchanted HP: ${resultMessage.rolled}!`
              : `Rolled ${resultMessage.rolled} HP — didn't beat the current enchant. Gem consumed.`}
          </div>
        )}

        {errorMessage && <p className="text-center text-[11px] text-red-400">{errorMessage}</p>}

        <div className="w-full max-w-xs space-y-2">
          {!selectedItem ? (
            <p className="text-center text-[11px] text-slate-600">Drag an item into the Upgrade Slot.</p>
          ) : !stagedGem ? (
            <p className="text-center text-[11px] text-slate-600">Drag a gem into the Gem slot.</p>
          ) : (
            <button
              type="button"
              disabled={busy || rolling}
              onClick={() => void handleEnchant()}
              className="w-full rounded-lg border border-emerald-600 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rolling ? 'Rolling…' : 'Enchant'}
            </button>
          )}
        </div>
      </ForgeTwoColumnLayout>
    </DragDropProvider>
  )
}
