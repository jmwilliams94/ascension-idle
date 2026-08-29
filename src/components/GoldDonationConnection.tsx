import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useGoldDonationStore, type GoldDonationPool } from '../game/goldDonation/useGoldDonationStore'
import { useTabActivityStore } from '../lib/useTabActivityStore'

function toPool(row: Record<string, unknown>): GoldDonationPool {
  return {
    id: row.id as string,
    targetAmount: Number(row.target_amount),
    totalDonated: Number(row.total_donated),
    status: row.status as GoldDonationPool['status'],
    buffCategory: (row.buff_category as GoldDonationPool['buffCategory']) ?? null,
    buffMultiplier: row.buff_multiplier === null || row.buff_multiplier === undefined ? null : Number(row.buff_multiplier),
    buffStartedAt: (row.buff_started_at as string | null) ?? null,
    buffEndsAt: (row.buff_ends_at as string | null) ?? null,
  }
}

// Non-visual, mounted unconditionally in GameShell alongside
// ZoneBossConnection — literal structural copy of that same seed-then-
// subscribe pattern. Not account-scoped (the donation pool is a single
// global object every player watches), so this needs no props.
export default function GoldDonationConnection() {
  const setPool = useGoldDonationStore((state) => state.setPool)
  const ensurePool = useGoldDonationStore((state) => state.ensurePool)

  useEffect(() => {
    let cancelled = false

    // Lazy lifecycle trigger — advances a long-idle pool (payout + gap +
    // reroll) the moment anyone loads the app at all, not just when they
    // open the Events tab.
    void ensurePool()

    void supabase
      .from('gold_donation_pools')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data && data.length > 0) {
          setPool(toPool(data[0] as Record<string, unknown>))
        }
      })

    const channel = supabase.channel('gold-donation').on(
      'postgres_changes',
      // INSERT = a new pool just rolled after the gap elapsed; UPDATE = a
      // donation landed, the buff triggered, or the buff window ended.
      { event: '*', schema: 'public', table: 'gold_donation_pools' },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          // Detect the buff just triggering (status flipping to 'active')
          // before overwriting the store, so a bare donation-total tick
          // (status still 'collecting') doesn't also flag the tab.
          const wasActive = useGoldDonationStore.getState().pool?.status === 'active'
          const pool = toPool(payload.new as Record<string, unknown>)
          setPool(pool)
          if (pool.status === 'active' && !wasActive) {
            useTabActivityStore.getState().markPending()
          }
        }
      },
    )

    channel.subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [setPool, ensurePool])

  return null
}
