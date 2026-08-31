import { useState } from 'react'
import { AscensionCard } from '../ui/AscensionCard'
import { Button } from '../ui/Button'
import { usePvpTournamentStore } from '../../game/pvp/usePvpTournamentStore'

// Phase 3 lobby — replaces PvpDuelBoard's old bare "No active duel right
// now" placeholder. Most players are looking at this screen most of the
// time (only two are ever mid-duel at once), so it needs to carry the
// actual weekly-event experience: last week's champion, the live
// registration ladder, and the bracket once the event's underway.

const RANK_ACCENT: Record<number, string> = {
  1: 'text-amber-300',
  2: 'text-slate-300',
  3: 'text-orange-400',
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function PvpTournamentLobby({ characterId }: { characterId: string }) {
  const currentTournament = usePvpTournamentStore((state) => state.currentTournament)
  const lastCompletedTournament = usePvpTournamentStore((state) => state.lastCompletedTournament)
  const registrations = usePvpTournamentStore((state) => state.registrations)
  const matches = usePvpTournamentStore((state) => state.matches)
  const busy = usePvpTournamentStore((state) => state.busy)
  const register = usePvpTournamentStore((state) => state.register)

  const [registerError, setRegisterError] = useState<string | null>(null)

  const isRegistered = registrations.some((r) => r.characterId === characterId)

  const handleRegister = () => {
    setRegisterError(null)
    void register(characterId).then((result) => {
      if (!result.ok) setRegisterError(result.error ?? 'action_failed')
    })
  }

  const roundsAscending = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b)

  return (
    <AscensionCard title="PvP Tournament">
      <div className="space-y-4">
        {lastCompletedTournament?.winnerName && (
          <div className="rounded-md border border-amber-600/50 bg-amber-950/20 px-3 py-2 text-center">
            <p className="text-heading-label">Last Week's Champion</p>
            <p className="mt-0.5 font-heading text-lg font-black text-amber-300">
              {lastCompletedTournament.winnerName}
              {lastCompletedTournament.championTitle && (
                <span className="ml-2 text-xs font-medium uppercase tracking-wide text-amber-400/80">
                  {lastCompletedTournament.championTitle}
                </span>
              )}
            </p>
          </div>
        )}

        {!currentTournament && <p className="text-center text-sm text-slate-400">No tournament data available.</p>}

        {currentTournament?.status === 'registration' && (
          <div className="space-y-3">
            <p className="text-center text-sm text-slate-400">
              Registration open — event starts <span className="text-slate-200">{formatEventTime(currentTournament.eventStartsAt)}</span>
            </p>

            {isRegistered ? (
              <p className="text-center text-sm text-emerald-400">You're registered for this week's event.</p>
            ) : (
              <Button onClick={handleRegister} disabled={busy} className="mx-auto block w-full max-w-xs">
                Register
              </Button>
            )}
            {registerError && <p className="text-center text-xs text-rose-400">{registerError}</p>}

            <div>
              <p className="text-heading-label mb-1">Ladder ({registrations.length})</p>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {registrations.length === 0 && <p className="text-center text-xs text-slate-500">No one's registered yet.</p>}
                {registrations.map((entry, index) => (
                  <div key={entry.characterId} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-sm">
                    <span className={`w-8 shrink-0 font-bold ${RANK_ACCENT[index + 1] ?? 'text-slate-500'}`}>#{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-200">
                      {entry.characterName}
                      {entry.characterId === characterId && <span className="ml-1 text-xs text-slate-500">(you)</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {currentTournament?.status === 'live' && (
          <div className="space-y-3">
            <p className="text-center text-sm text-amber-300">Event live!</p>
            {roundsAscending.map((round) => (
              <div key={round}>
                <p className="text-heading-label mb-1">Round {round}</p>
                <div className="space-y-1">
                  {matches
                    .filter((m) => m.round === round)
                    .map((match) => {
                      const isBye = !match.characterBId
                      const involvesMe = match.characterAId === characterId || match.characterBId === characterId
                      return (
                        <div
                          key={match.id}
                          className={`flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm ${
                            involvesMe ? 'border-amber-600/60 bg-amber-950/10' : 'border-slate-800 bg-slate-900/40'
                          }`}
                        >
                          <span className={match.winnerCharacterId === match.characterAId ? 'font-bold text-emerald-400' : 'text-slate-300'}>
                            {match.characterAName ?? '—'}
                          </span>
                          <span className="text-xs uppercase tracking-wide text-slate-600">{isBye ? 'bye' : 'vs'}</span>
                          <span
                            className={`text-right ${
                              match.winnerCharacterId && match.winnerCharacterId === match.characterBId ? 'font-bold text-emerald-400' : 'text-slate-300'
                            }`}
                          >
                            {match.characterBName ?? (isBye ? 'advances' : '—')}
                          </span>
                        </div>
                      )
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AscensionCard>
  )
}
