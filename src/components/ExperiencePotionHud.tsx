import { useEffect, useState, type CSSProperties } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { EXPERIENCE_POTION_ICON_SRC } from '../game/items/forgeCosts'

// Small readout, shown in GameShell's top HUD strip alongside VipStatusHud —
// confirms an Experience Potion's Use actually worked and shows the
// remaining time. No modal/settings to open (unlike VipStatusHud), so this
// is just a static badge, no desktop/mobile click behavior. Renders nothing
// once exp_potion_expires_at has passed or was never set.
export default function ExperiencePotionHud() {
  const expPotionExpiresAt = useCharacterStore((state) => state.expPotionExpiresAt)

  // Same "Date.now() into state via a slow interval, never read live during
  // render" pattern as VipStatusHud's own countdown.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  if (!expPotionExpiresAt) {
    return null
  }

  const remainingMs = new Date(expPotionExpiresAt).getTime() - now
  if (remainingMs <= 0) {
    return null
  }

  const minutesLeft = Math.max(1, Math.ceil(remainingMs / 60_000))
  const label = minutesLeft >= 60 ? `${Math.ceil(minutesLeft / 60)}h left` : `${minutesLeft}m left`

  // Green, matching CONSUMABLE_COLOR (Potions' established color elsewhere)
  // rather than introducing a new tint.
  const expPotionTintStyle = { '--ascension-tint': '#4ADE80' } as CSSProperties

  return (
    <div className="relative shrink-0" data-experience-potion-hud>
      <div className="ascension-chip-frame is-tinted" style={expPotionTintStyle}>
        <div
          title={`2x EXP from kills until ${new Date(expPotionExpiresAt).toLocaleString()}`}
          className="ascension-chip-inner flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-200"
        >
          <img src={EXPERIENCE_POTION_ICON_SRC} alt="Experience Potion" className="h-4 w-4 object-contain" />
          <span className="hidden lg:inline">2x EXP · {label}</span>
        </div>
      </div>
    </div>
  )
}
