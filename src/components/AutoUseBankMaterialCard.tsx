import type { CSSProperties, ReactNode } from 'react'
import { COMET_ICON_SRC, effectiveCurrencyAvailable, FALLEN_STAR_ICON_SRC } from '../game/items/forgeCosts'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useVipAutomationStore } from '../game/vip/useVipAutomationStore'

// Violet, not the app's true `purple` (Ascension Points' own established
// currency color) — same substitution VipStatusHud.tsx/VipSettingsModal.tsx
// already use for "VIP purple" requests.
const VIP_TINT = '#8b5cf6'

interface AutoUseBankMaterialCardProps {
  // Auto-Repeat's own toggle (Level Upgrade only, ForgeStandardPanel.tsx) —
  // rendered here instead of its old spot next to Confirm/Cancel (2026-09-05,
  // per the user: "I don't know where that went" — consolidates every VIP
  // Forge control into one place). Its state/loop logic stays owned by
  // ForgeStandardPanel (depends on the currently staged item); this component
  // just hosts the button.
  repeatButton?: ReactNode
}

// VIP-gated card, top-right of ForgeStandardPanel (2026-09-05, moved here per
// the user after a couple of placement iterations — was next to
// EquippedGearPicker, then briefly pinned above the upgrade slots). A
// three-way single-select — Off / Comet / Fallen Star — for which currency
// (if any) a Level/Quality Upgrade should draw from the account Bank when
// Inventory comes up short; "Off" is an explicit, always-available option
// (not just "tap the active one again"), per the user's own callout that the
// no-auto choice must stay reachable. Selecting a currency also drives
// ForgeStandardPanel's auto-fill-on-drop behavior for the Material slot.
export default function AutoUseBankMaterialCard({ repeatButton }: AutoUseBankMaterialCardProps) {
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
  const selected = useVipAutomationStore((state) => state.settings.autoUseBankMaterial)
  const updateSettings = useVipAutomationStore((state) => state.updateSettings)
  const comets = useCurrencyStore((state) => state.comets)
  const cometScrolls = useCurrencyStore((state) => state.cometScrolls)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const fallenStarScrolls = useCurrencyStore((state) => state.fallenStarScrolls)

  const vipTintStyle = { '--ascension-tint': VIP_TINT } as CSSProperties

  // Inventory-side quantity only (loose + Scrolls) — the whole point of this
  // feature is covering what Inventory *can't*, so this number is what's on
  // hand before any Bank draw, not a combined total.
  const quantity =
    selected === 'comet'
      ? effectiveCurrencyAvailable(comets, cometScrolls)
      : selected === 'fallen_star'
        ? effectiveCurrencyAvailable(fallenStars, fallenStarScrolls)
        : null

  const select = (currency: 'comet' | 'fallen_star' | null) => void updateSettings({ autoUseBankMaterial: currency })

  const optionButtonClass = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded-lg border text-xs transition ${
      active ? 'border-violet-300 bg-violet-300/20 text-violet-100' : 'border-slate-700 text-slate-300 opacity-60 hover:opacity-100'
    }`

  return (
    <div className="ascension-card-frame is-tinted" style={vipTintStyle} title="VIP: auto-use a Bank material in the Forge">
      <div className="ascension-card-inner flex flex-col items-center gap-2 p-2.5 text-center">
        <span className="text-[10px] font-heading font-bold uppercase tracking-[0.06em] text-violet-200">VIP Auto-Use</span>

        {!isVipActive ? (
          <span className="py-1 text-lg" title="Requires VIP">
            🔒
          </span>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => select(null)}
                aria-pressed={selected === null}
                title="Off — Comets/Fallen Stars come from Inventory only"
                className={optionButtonClass(selected === null)}
              >
                🚫
              </button>
              <button type="button" onClick={() => select('comet')} aria-pressed={selected === 'comet'} title="Auto-use Comets from Bank when Forging" className={optionButtonClass(selected === 'comet')}>
                <img src={COMET_ICON_SRC} alt="Comet" className="h-4 w-4 object-contain" />
              </button>
              <button
                type="button"
                onClick={() => select('fallen_star')}
                aria-pressed={selected === 'fallen_star'}
                title="Auto-use Fallen Stars from Bank when Forging"
                className={optionButtonClass(selected === 'fallen_star')}
              >
                <img src={FALLEN_STAR_ICON_SRC} alt="Fallen Star" className="h-4 w-4 object-contain" />
              </button>
            </div>

            {quantity !== null && <p className="text-[10px] text-violet-200/90">Quantity: {quantity}</p>}

            {repeatButton}
          </>
        )}
      </div>
    </div>
  )
}
