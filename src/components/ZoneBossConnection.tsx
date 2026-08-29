import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useZoneBossStore, type ZoneBossSpawn } from '../game/zoneboss/useZoneBossStore'
import type { ZoneBossId } from '../game/zones/zoneBossData'
import { useTabActivityStore } from '../lib/useTabActivityStore'

function toSpawn(row: Record<string, unknown>): ZoneBossSpawn {
  return {
    id: row.id as string,
    bossId: row.boss_id as ZoneBossId,
    maxHp: Number(row.max_hp),
    currentHp: Number(row.current_hp),
    physicalDefense: Number(row.physical_defense),
    magicDefense: Number(row.magic_defense),
    windowStartedAt: row.window_started_at as string,
    windowEndsAt: row.window_ends_at as string,
    status: row.status as 'active' | 'ended',
  }
}

// Non-visual, mounted unconditionally in GameShell alongside
// GlobalActivityConnection/MailRealtimeConnection — same seed-then-subscribe
// pattern as GlobalActivityConnection.tsx. Not account-scoped (the boss is a
// single global object every player watches), so this needs no props. Still
// subscribes to world_boss_spawns — DB table names stay world_boss_*
// internally, see the zone_boss_rotation migration header.
export default function ZoneBossConnection() {
  const setSpawn = useZoneBossStore((state) => state.setSpawn)
  const ensureSpawn = useZoneBossStore((state) => state.ensureSpawn)

  useEffect(() => {
    let cancelled = false

    // Lazy lifecycle trigger — advances a long-idle boss the moment anyone
    // loads the app at all, not just when they open the Events tab.
    void ensureSpawn()

    void supabase
      .from('world_boss_spawns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data && data.length > 0) {
          setSpawn(toSpawn(data[0] as Record<string, unknown>))
        }
      })

    const channel = supabase.channel('world-boss').on(
      'postgres_changes',
      // INSERT = a new spawn just rolled after the old one ended; UPDATE =
      // HP decremented by an attack, or status flipped to 'ended'.
      { event: '*', schema: 'public', table: 'world_boss_spawns' },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setSpawn(toSpawn(payload.new as Record<string, unknown>))
          // INSERT only — a fresh spawn window opening is notification-
          // worthy, HP ticking down from other players' attacks isn't.
          if (payload.eventType === 'INSERT') {
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
  }, [setSpawn, ensureSpawn])

  return null
}
