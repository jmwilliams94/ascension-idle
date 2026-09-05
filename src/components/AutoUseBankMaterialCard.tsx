import type { CSSProperties } from 'react'
import { COMET_ICON_SRC, FALLEN_STAR_ICON_SRC } from '../game/items/forgeCosts'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useVipAutomationStore } from '../game/vip/useVipAutomationStore'

// Violet, not the app's true `purple` (Ascension Points' own established
// currency color) — same substitution VipStatusHud.tsx/VipSettingsModal.tsx
// already use for "VIP purple" requests.
const VIP_TINT = '#8b5cf6'

// Small VIP-gated chip, kept persistently visible in ForgeStandardPanel
// (2026-09-05, moved off the EquippedGearPicker row per the user — it used
// to live only next to that picker and disappeared the moment an item was
// staged, which hid the very toggle a player would want to check mid-flow).
// Single-select — ticking Comet or Fallen Star as the "auto-use material"
// also drives ForgeStandardPanel's auto-fill-on-drop behavior, so only one
// can be active (tapping the active one again clears it back to null/off).
// When set, a Forge Level/Quality Upgrade that comes up short on that
// currency draws the shortfall straight from the account Bank
// (ensure_forge_currency SQL) instead of refusing the attempt. A non-VIP
// character sees the same frame locked, matching the "Requires VIP" pattern
// ForgeStandardPanel.tsx's Auto-Repeat button already uses.
export default function AutoUseBankMaterialCard() {
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
  const selected = useVipAutomationStore((state) => state.settings.autoUseBankMaterial)
  const updateSettings = useVipAutomationStore((state) => state.updateSettings)

  const vipTintStyle = { '--ascension-tint': VIP_TINT } as CSSProperties

  const select = (currency: 'comet' | 'fallen_star') =>
    void updateSettings({ autoUseBankMaterial: selected === currency ? null : currency })

  return (
    <div className="ascension-chip-frame is-tinted" style={vipTintStyle} title="VIP: auto-use a Bank material in the Forge">
      <div className="ascension-chip-inner flex items-center gap-2 px-3 py-1.5">
        <span className="text-[10px] font-heading font-bold uppercase tracking-[0.06em] text-violet-200">VIP Auto-Use</span>

        {!isVipActive ? (
          <span className="text-sm" title="Requires VIP">
            🔒
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => select('comet')}
              aria-pressed={selected === 'comet'}
              title="Auto-use Comets from Bank when Forging"
              className={`flex items-center justify-center rounded-lg border p-1 transition ${
                selected === 'comet' ? 'border-violet-300 bg-violet-300/20' : 'border-slate-700 opacity-60 hover:opacity-100'
              }`}
            >
              <img src={COMET_ICON_SRC} alt="Comet" className="h-4 w-4 object-contain" />
            </button>
            <button
              type="button"
              onClick={() => select('fallen_star')}
              aria-pressed={selected === 'fallen_star'}
              title="Auto-use Fallen Stars from Bank when Forging"
              className={`flex items-center justify-center rounded-lg border p-1 transition ${
                selected === 'fallen_star' ? 'border-violet-300 bg-violet-300/20' : 'border-slate-700 opacity-60 hover:opacity-100'
              }`}
            >
              <img src={FALLEN_STAR_ICON_SRC} alt="Fallen Star" className="h-4 w-4 object-contain" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
