import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { usePvpTournamentStore } from '../game/pvp/usePvpTournamentStore'

// Non-visual, mounted unconditionally in GameShell alongside ZoneBossConnection
// — the tournament ladder/bracket/champion are public/global, not scoped to
// a character, same as the world boss. Refetches the whole relevant slice on
// any change across the 3 tournament tables rather than patching incrementally
// (see usePvpTournamentStore.ts's own comment on why that's fine here).
export default function PvpTournamentConnection() {
  const loadAll = usePvpTournamentStore((state) => state.loadAll)

  useEffect(() => {
    let cancelled = false

    void loadAll()

    const channel = supabase
      .channel('pvp-tournament')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pvp_tournaments' }, () => {
        if (!cancelled) void loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pvp_tournament_registrations' }, () => {
        if (!cancelled) void loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pvp_tournament_matches' }, () => {
        if (!cancelled) void loadAll()
      })

    channel.subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [loadAll])

  return null
}
