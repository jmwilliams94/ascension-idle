import type { CSSProperties } from 'react'
import { COMET_ICON_SRC, FALLEN_STAR_ICON_SRC } from '../game/items/forgeCosts'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useVipAutomationStore } from '../game/vip/useVipAutomationStore'

// Violet, not the app's true `purple` (Ascension Points' own established
// currency color) — same substitution VipStatusHud.tsx/VipSettingsModal.tsx
// already use for "VIP purple" requests.
const VIP_TINT = '#8b5cf6'

// Small VIP-gated card, docked beside ForgeStandardPanel's EquippedGearPicker
// (the "or pick an equipped item" row shown while upgrading gear — requested
// by the user, moved here from an earlier Equipment-tab placement). Lets a
// VIP designate Comet and/or Fallen Star as an "auto-use material" — when
// ticked, a Forge Level/Quality Upgrade that comes up short on that currency
// draws the shortfall straight from the account Bank (ensure_forge_currency
// SQL) instead of refusing the attempt. A non-VIP character sees the same
// frame locked, matching the "Requires VIP" pattern ForgeStandardPanel.tsx's
// Auto-Repeat button already uses.
export default function AutoUseBankMaterialCard() {
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
  const settings = useVipAutomationStore((state) => state.settings)
  const updateSettings = useVipAutomationStore((state) => state.updateSettings)

  const vipTintStyle = { '--ascension-tint': VIP_TINT } as CSSProperties

  const toggle = (currency: 'comet' | 'fallen_star') =>
    void updateSettings({
      autoUseBankMaterial: { ...settings.autoUseBankMaterial, [currency]: !settings.autoUseBankMaterial[currency] },
    })

  return (
    <div
      className="ascension-card-frame is-tinted w-14 shrink-0 lg:w-20"
      style={vipTintStyle}
      title="VIP: auto-use Bank materials in the Forge"
    >
      <div className="ascension-card-inner flex flex-col items-center gap-1.5 p-1.5 text-center lg:gap-2 lg:p-2">
        <span className="text-[9px] font-heading font-bold uppercase leading-tight tracking-[0.06em] text-violet-200">VIP</span>

        {!isVipActive ? (
          <div className="flex flex-col items-center gap-1 py-2 text-violet-200/70" title="Requires VIP">
            <span className="text-lg">🔒</span>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-1.5">
            <button
              type="button"
              onClick={() => toggle('comet')}
              aria-pressed={settings.autoUseBankMaterial.comet}
              title="Auto-use Comets from Bank when Forging"
              className={`flex items-center justify-center rounded-lg border p-1 transition ${
                settings.autoUseBankMaterial.comet
                  ? 'border-violet-300 bg-violet-300/20'
                  : 'border-slate-700 opacity-60 hover:opacity-100'
              }`}
            >
              <img src={COMET_ICON_SRC} alt="Comet" className="h-5 w-5 object-contain" />
            </button>
            <button
              type="button"
              onClick={() => toggle('fallen_star')}
              aria-pressed={settings.autoUseBankMaterial.fallen_star}
              title="Auto-use Fallen Stars from Bank when Forging"
              className={`flex items-center justify-center rounded-lg border p-1 transition ${
                settings.autoUseBankMaterial.fallen_star
                  ? 'border-violet-300 bg-violet-300/20'
                  : 'border-slate-700 opacity-60 hover:opacity-100'
              }`}
            >
              <img src={FALLEN_STAR_ICON_SRC} alt="Fallen Star" className="h-5 w-5 object-contain" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
