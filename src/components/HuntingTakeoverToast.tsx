import { useEffect } from 'react'
import { useHuntingTakeoverToastStore } from '../game/combat/useHuntingTakeoverToastStore'

// Mirrors PetToast.tsx's exact pattern (nullable single-value store field,
// local setTimeout auto-clear, absolutely-positioned banner) — see
// useHuntingTakeoverToastStore.ts for why this fires.
export default function HuntingTakeoverToast() {
  const displacedCharacterName = useHuntingTakeoverToastStore((state) => state.displacedCharacterName)
  const dismiss = useHuntingTakeoverToastStore((state) => state.dismiss)

  useEffect(() => {
    if (displacedCharacterName === null) {
      return undefined
    }

    const timeout = setTimeout(() => dismiss(), 4000)
    return () => clearTimeout(timeout)
  }, [displacedCharacterName, dismiss])

  if (displacedCharacterName === null) {
    return null
  }

  return (
    <div className="rounded-lg border border-sky-400/60 bg-sky-400/10 px-3 py-1.5 text-center text-xs font-semibold text-sky-300 backdrop-blur">
      Only one character can Hunt at a time — took over from {displacedCharacterName}, who switched to Mining.
    </div>
  )
}
