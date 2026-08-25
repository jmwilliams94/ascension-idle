import { useEffect, useState } from 'react'
import { useLuckyStore } from '../lucky/useLuckyStore'
import type { EventEmberColor } from './useEventEmberColor'

// LuckyLad nav-button embers — same border-ember/outline-ring effect as the
// Idling button's World Boss/Gold Donation embers (see useEventEmberColor.ts),
// just triggered by the free 4h ticket cooldown (LUCKY_FREE_TICKET_COOLDOWN_MS,
// see useLuckyStore) elapsing instead of a server event.
export function useLuckyFreeEmberColor(): EventEmberColor | null {
  const nextFreeTicketAt = useLuckyStore((state) => state.nextFreeTicketAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(id)
  }, [])

  const freeAvailable = !nextFreeTicketAt || nextFreeTicketAt <= now
  return freeAvailable ? 'luckyFree' : null
}
