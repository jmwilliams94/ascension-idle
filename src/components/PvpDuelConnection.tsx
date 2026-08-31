import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { usePvpDuelStore, toDuel } from '../game/pvp/usePvpDuelStore'

// Non-visual, mounted in GameShell alongside ZoneBossConnection/
// GoldDonationConnection — same seed-then-subscribe pattern (see CLAUDE.md's
// plan nifty-riding-journal, Phase 2). Unlike those, this IS scoped to the
// active character (a duel is between two specific characters, not a single
// global object) — no-ops entirely while no character is selected.
//
// No server-side filter on the realtime subscription: postgres_changes only
// supports a single `column=eq.value` filter, and a duel's participant could
// be in either player_a_character_id or player_b_character_id — so this
// subscribes to every pvp_duels change and filters client-side instead (fine
// at this feature's current scale; revisit if duel volume ever grows enough
// to matter).
export default function PvpDuelConnection({ characterId }: { characterId: string | null }) {
  const setDuel = usePvpDuelStore((state) => state.setDuel)
  const loadActiveDuel = usePvpDuelStore((state) => state.loadActiveDuel)

  useEffect(() => {
    if (!characterId) {
      return undefined
    }

    let cancelled = false

    void loadActiveDuel(characterId)

    const channel = supabase.channel(`pvp-duel-${characterId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pvp_duels' },
      (payload) => {
        if (cancelled) return
        const row = (payload.new ?? payload.old) as Record<string, unknown> | null
        if (!row) return
        const isParticipant = row.player_a_character_id === characterId || row.player_b_character_id === characterId
        if (!isParticipant) return

        const current = usePvpDuelStore.getState().duel
        // Only INSERT/UPDATE carry a usable `new` row — apply it if it's the
        // duel we're already tracking, or if we have none tracked yet and
        // this one just went active (covers a fresh duel starting without a
        // page reload, e.g. once Phase 3's tournament matches exist).
        if (payload.eventType !== 'DELETE') {
          if (!current || current.id === row.id || row.status === 'active') {
            setDuel(toDuel(row), characterId)
          }
        }
      },
    )

    channel.subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [characterId, setDuel, loadActiveDuel])

  return null
}
