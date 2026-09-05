import { useEffect, useState } from 'react'
import { fetchPvpTournamentMatches, type PvpTournament, type PvpTournamentMatch } from '../../game/pvp/usePvpTournamentStore'
import { useLockBodyScroll } from '../../lib/useLockBodyScroll'
import { PvpMatchRow } from './PvpMatchRow'

// "View Bracket" breakdown for a past tournament (2026-09-05, requested by
// the user) — the live event already shows its own round-by-round bracket
// inline on PvpTournamentLobby, but that view disappears the instant the
// tournament flips to 'completed' even though pvp_tournament_matches still
// holds the full history. This is the one place that history is still
// reachable — only ever mounted while open (`{show && <PvpBracketModal .../>}`
// in PvpTournamentLobby), so useLockBodyScroll's `active` default of true is
// correct here.
export default function PvpBracketModal({
  tournament,
  characterId,
  onClose,
}: {
  tournament: PvpTournament
  characterId: string
  onClose: () => void
}) {
  const [matches, setMatches] = useState<PvpTournamentMatch[] | null>(null)
  useLockBodyScroll()

  useEffect(() => {
    let cancelled = false
    void fetchPvpTournamentMatches(tournament.id).then((rows) => {
      if (!cancelled) setMatches(rows)
    })
    return () => {
      cancelled = true
    }
  }, [tournament.id])

  const roundsAscending = matches ? [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">Bracket Breakdown</h2>
            {tournament.winnerName && (
              <p className="truncate text-xs text-amber-300">
                Champion: {tournament.winnerName}
                {tournament.championTitle ? ` — ${tournament.championTitle}` : ''}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {!matches ? (
            <p className="py-6 text-center text-sm text-slate-300">Loading…</p>
          ) : matches.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-300">No match data for this event.</p>
          ) : (
            roundsAscending.map((round) => (
              <div key={round}>
                <p className="text-heading-label mb-1">Round {round}</p>
                <div className="space-y-1">
                  {matches
                    .filter((m) => m.round === round)
                    .map((match) => (
                      <PvpMatchRow
                        key={match.id}
                        match={match}
                        highlight={match.characterAId === characterId || match.characterBId === characterId}
                      />
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
