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

  const bossActive = spawn ? spawn.status === 'active' && new Date(spawn.windowEndsAt).getTime() > now : false
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
