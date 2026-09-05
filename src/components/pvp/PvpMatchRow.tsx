import type { PvpTournamentMatch } from '../../game/pvp/usePvpTournamentStore'

// Single "A vs B" bracket row — shared by PvpTournamentLobby's live-event
// bracket and PvpBracketModal's past-event breakdown, so the two don't drift
// apart (winner bolded/green, bye labeled) as separate hand-copies.
export function PvpMatchRow({ match, highlight = false }: { match: PvpTournamentMatch; highlight?: boolean }) {
  const isBye = !match.characterBId

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm ${
        highlight ? 'border-amber-600/60 bg-amber-950/10' : 'border-slate-800 bg-slate-900/40'
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
}
