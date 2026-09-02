import { useEffect } from 'react'
import { useRequiresVipToastStore } from '../game/vip/useRequiresVipToastStore'

// Violet (VIP's own established tint, see VipSettingsModal.tsx), not the
// app's true `purple` (Ascension Points).
const VIP_TINT = '#8b5cf6'

// Mirrors HuntingTakeoverToast.tsx's exact pattern (nullable single-value
// store field, local setTimeout auto-clear, absolutely-positioned banner).
export default function RequiresVipToast() {
  const message = useRequiresVipToastStore((state) => state.message)
  const dismiss = useRequiresVipToastStore((state) => state.dismiss)

  useEffect(() => {
    if (message === null) {
      return undefined
    }

    const timeout = setTimeout(() => dismiss(), 2400)
    return () => clearTimeout(timeout)
  }, [message, dismiss])

  if (message === null) {
    return null
  }

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-center text-xs font-semibold backdrop-blur will-change-transform lg:top-20"
      style={{ borderColor: `${VIP_TINT}99`, backgroundColor: `${VIP_TINT}1a`, color: VIP_TINT }}
    >
      👑 {message}
    </div>
  )
}
