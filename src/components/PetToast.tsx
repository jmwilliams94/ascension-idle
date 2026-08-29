import { useEffect } from 'react'
import { usePetToastStore } from '../game/achievements/usePetToastStore'

// Live pet-obtained celebration toast (2026-08-03, confirmed with the
// user — the pet drop rate/notification pass) — mirrors ExpBar.tsx's own
// level-up toast pattern exactly (nullable single-value store field, local
// setTimeout auto-clear, absolutely-positioned banner), the only prior
// "one-off celebratory notice" precedent in this codebase. Mounted in
// GameShell's top HUD strip alongside ExpBar so it's visible from every
// tab, not just Combat — same reasoning as the level-up toast. A pet is a
// bigger deal than a level-up, so it stays up longer (4s vs. 2.2s).
export default function PetToast() {
  const monsterName = usePetToastStore((state) => state.monsterName)
  const dismiss = usePetToastStore((state) => state.dismiss)

  useEffect(() => {
    if (monsterName === null) {
      return undefined
    }

    const timeout = setTimeout(() => dismiss(), 4000)
    return () => clearTimeout(timeout)
  }, [monsterName, dismiss])

  if (monsterName === null) {
    return null
  }

  return (
    <div className="rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-1.5 text-center text-xs font-semibold text-amber-300 backdrop-blur will-change-transform">
      🎉 You obtained the {monsterName} pet!
    </div>
  )
}
