import { useEffect } from 'react'
import { useDailyQuestsStore } from '../game/dailyQuests/useDailyQuestsStore'

// Non-visual, mounted unconditionally in GameShell. Purely per-character
// state (no cross-player Realtime channel needed, unlike GoldDonationConnection/
// ZoneBossConnection) — a lazy `ensure` call on mount rolls today's 3 quests if
// none exist yet, plus a 5-minute re-check so a long-open tab still notices the
// UTC-midnight rollover without a page reload.
export default function DailyQuestsConnection({ characterId }: { characterId: string }) {
  const ensure = useDailyQuestsStore((state) => state.ensure)

  useEffect(() => {
    void ensure(characterId)
    const interval = setInterval(() => void ensure(characterId), 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [characterId, ensure])

  return null
}
