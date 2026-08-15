import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useWorldBossStore, type WorldBossSpawn } from '../game/worldboss/useWorldBossStore'

function toSpawn(row: Record<string, unknown>): WorldBossSpawn {
  return {
    id: row.id as string,
    maxHp: Number(row.max_hp),
    currentHp: Number(row.current_hp),
    windowStartedAt: row.window_started_at as string,
    windowEndsAt: row.window_ends_at as string,
    status: row.status as 'active' | 'ended',
  }
}

// Non-visual, mounted unconditionally in GameShell alongside
// GlobalActivityConnection/MailRealtimeConnection — same seed-then-subscribe
// pattern as GlobalActivityConnection.tsx. Not account-scoped (the boss is a
// single global object every player watches), so this needs no props.
export default function WorldBossConnection() {
  const setSpawn = useWorldBossStore((state) => state.setSpawn)
  const ensureSpawn = useWorldBossStore((state) => state.ensureSpawn)

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
