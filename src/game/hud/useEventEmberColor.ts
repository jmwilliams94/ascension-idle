import { useEffect, useState } from 'react'
import { useZoneBossStore } from '../zoneboss/useZoneBossStore'
import { useGoldDonationStore, getActiveGoldDonationEvent } from '../goldDonation/useGoldDonationStore'

export type EventEmberColor = 'boss' | 'buffActive' | 'collecting' | 'luckyFree'

// Idling nav button embers (CLAUDE.server-events.md's Zone Boss + Gold
// Donation Event). Zone Boss and Gold Donation run on independent random
// timers, so both can genuinely be live at once — this is a front-end-only
// visual priority (no backend coordination) so only one color ever shows:
// Red (boss fight live) beats Green (donation buff live) beats Gold (pool
// still collecting, no buff triggered yet).
export function useActiveEventEmberColor(): EventEmberColor | null {
  const spawn = useZoneBossStore((state) => state.spawn)
  const pool = useGoldDonationStore((state) => state.pool)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(id)
  }, [])

  // currentHp > 0 excludes a boss that's already been killed but whose spawn
  // row hasn't flipped to 'ended' yet (status only transitions on window
  // expiry, not on the killing blow — see useZoneBossStore.ts) — otherwise
  // the ember kept showing "fight live" for a defeated boss with nothing
  // left to attack, for as long as the rest of its 6-8h window ran.
  const bossActive = spawn ? spawn.status === 'active' && spawn.currentHp > 0 && new Date(spawn.windowEndsAt).getTime() > now : false
  if (bossActive) {
    return 'boss'
  }

  if (getActiveGoldDonationEvent(pool, now)) {
    return 'buffActive'
  }

  if (pool?.status === 'collecting') {
    return 'collecting'
  }

  return null
}
