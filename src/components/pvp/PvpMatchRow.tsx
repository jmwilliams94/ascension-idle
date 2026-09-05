import type { PvpTournamentMatch } from '../../game/pvp/usePvpTournamentStore'

// Single "A vs B" bracket row — shared by PvpTournamentLobby's live-event
// bracket and PvpBracketModal's past-event breakdown, so the two don't drift
// apart as separate hand-copies. Winner bolded green, loser red (2026-09-05,
// requested by the user), a bye/undecided match stays neutral slate. Winner's
// HP remaining renders as a small line UNDERNEATH their name rather than
// bracketed next to it — the user offered both options; underneath reads
// cleaner on a narrow mobile width, where a "(143/500 HP)" suffix would
// compete with the name for the same single line instead of wrapping/
// truncating independently.
export function PvpMatchRow({ match, highlight = false }: { match: PvpTournamentMatch; highlight?: boolean }) {
  const isBye = !match.characterBId
  const decided = Boolean(match.winnerCharacterId)
  const aWon = match.winnerCharacterId === match.characterAId
  const bWon = decided && match.winnerCharacterId === match.characterBId
  const aLost = decided && !aWon
  const bLost = decided && !bWon && !isBye
  const hasHp = match.winnerHp !== null && match.winnerMaxHp !== null

  const nameClass = (won: boolean, lost: boolean) => (won ? 'font-bold text-emerald-400' : lost ? 'text-rose-400' : 'text-slate-300')

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm ${
        highlight ? 'border-amber-600/60 bg-amber-950/10' : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`truncate ${nameClass(aWon, aLost)}`}>{match.characterAName ?? '—'}</p>
        {aWon && hasHp && (
          <p className="text-[10px] text-emerald-400/70">
            {match.winnerHp}/{match.winnerMaxHp} HP left
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs uppercase tracking-wide text-slate-600">{isBye ? 'bye' : 'vs'}</span>
      <div className="min-w-0 flex-1 text-right">
        <p className={`truncate ${nameClass(bWon, bLost)}`}>{match.characterBName ?? (isBye ? 'advances' : '—')}</p>
        {bWon && hasHp && (
          <p className="text-[10px] text-emerald-400/70">
            {match.winnerHp}/{match.winnerMaxHp} HP left
          </p>
        )}
      </div>
    </div>
  )
}
