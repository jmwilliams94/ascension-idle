import { useEffect, useState } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { VIP_TOKEN_ICON_SRC } from '../game/items/forgeCosts'
import { useVipSettingsModalStore } from '../game/vip/useVipSettingsModalStore'

// Small readout, shown in GameShell's top HUD strip — confirms a VIP Token's
// Use actually worked and shows the remaining time. Clicking it opens
// VipSettingsModal, VIP's first real gameplay payoff (v1.108.0) — auto-sell
// Ore / auto-salvage / auto-bank / Auto-Forge repeat. Renders nothing for a
// character that's never been VIP, or whose VIP has lapsed (vip_expires_at in
// the past).
export default function VipStatusHud() {
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)

  // Same "Date.now() into state via a slow interval, never read live during
  // render" pattern as LuckyPanel's own free-ticket countdown — this only
  // needs to be roughly live, not to-the-second.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  if (!vipExpiresAt) {
    return null
  }

  const remainingMs = new Date(vipExpiresAt).getTime() - now
  if (remainingMs <= 0) {
    return null
  }

  const daysLeft = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))

  return (
    <button
      type="button"
      onClick={() => useVipSettingsModalStore.getState().openModal()}
      title={`VIP until ${new Date(vipExpiresAt).toLocaleString()} — click for VIP settings`}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 backdrop-blur transition hover:bg-amber-500/20"
    >
      <img src={VIP_TOKEN_ICON_SRC} alt="" className="h-4 w-4 object-contain" />
      VIP · {daysLeft}d left
    </button>
  )
}
