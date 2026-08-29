import { useEffect, useState } from 'react'
import ZoneBossCard from './ZoneBossCard'
import GoldDonationCard from './GoldDonationCard'
import { useZoneBossStore } from '../game/zoneboss/useZoneBossStore'
import { getActiveGoldDonationEvent, useGoldDonationStore } from '../game/goldDonation/useGoldDonationStore'
import type { EventEmberColor } from '../game/hud/useEventEmberColor'

// Renders both event cards for the Events sub-mode, ordering whichever one
// is currently "active" above the other (2026-10-11, requested by the user
// — previously Gold Donation was just a summary block permanently stacked
// above ZoneBossCard, with no own-card treatment). Priority mirrors the
// Idling nav button's ember color (useEventEmberColor.ts): a live boss fight
// beats a live donation buff beats a pool still collecting; if neither event
// is doing anything right now, Zone Boss keeps its original lead position.
// Each card only gets its OWN ember color, independent of the other's state
// — that's what makes the border sparkle only on whichever card the color
// actually belongs to.
export default function EventsCardStack({ characterId }: { characterId?: string | null }) {
  const spawn = useZoneBossStore((state) => state.spawn)
  const pool = useGoldDonationStore((state) => state.pool)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const bossActive = spawn ? spawn.status === 'active' && new Date(spawn.windowEndsAt).getTime() > now : false
  const zoneBossColor: EventEmberColor | null = bossActive ? 'boss' : null

  const goldDonationColor: EventEmberColor | null = getActiveGoldDonationEvent(pool, now)
    ? 'buffActive'
    : pool?.status === 'collecting'
      ? 'collecting'
      : null

  const goldDonationLeads = !zoneBossColor && !!goldDonationColor

  const zoneBoss = characterId ? <ZoneBossCard characterId={characterId} emberColor={zoneBossColor} /> : null
  const goldDonation = <GoldDonationCard characterId={characterId} now={now} emberColor={goldDonationColor} />

  return (
    <>
      {goldDonationLeads ? goldDonation : zoneBoss}
      {goldDonationLeads ? zoneBoss : goldDonation}
    </>
  )
}
