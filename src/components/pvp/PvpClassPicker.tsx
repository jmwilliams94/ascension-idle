import { AscensionCard } from '../ui/AscensionCard'
import { usePvpTournamentStore, type PvpEventClassId } from '../../game/pvp/usePvpTournamentStore'
import { CLASS_DEFINITIONS, type ClassId } from '../../game/stats/classes'

// 2x2 class picker (2026-09-05, requested by the user) — the PvP tab's new
// landing screen, replacing the old always-Hunter tournament lobby. One
// button per class, "our silver styling" via .ascension-chip-frame.is-
// interactive (the same primitive HUD pills/buttons already use) rather than
// a bespoke card-button hybrid. Twin-soul/Juggernaut have no backend event
// yet — their buttons are disabled and show "Coming Soon" instead of a
// day/time (the user's own choice: showing a Thu/Fri placeholder would imply
// a schedule that doesn't actually exist yet).
const PICKER_ORDER: ClassId[] = ['hunter', 'wuxia', 'twin-soul', 'juggernaut']

function formatEventSchedule(tournament: { status: string; eventStartsAt: string } | null): string {
  if (!tournament) {
    return '…'
  }
  if (tournament.status === 'live') {
    return 'Live now'
  }
  return new Date(tournament.eventStartsAt).toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function PvpClassPicker({ onSelect }: { onSelect: (classId: PvpEventClassId) => void }) {
  const byClass = usePvpTournamentStore((state) => state.byClass)

  return (
    <AscensionCard title="PvP Tournaments">
      <div className="grid grid-cols-2 gap-3">
        {PICKER_ORDER.map((classId) => {
          const isLive = classId === 'hunter' || classId === 'wuxia'
          const schedule = isLive ? formatEventSchedule(byClass[classId as PvpEventClassId].currentTournament) : 'Coming Soon'

          return (
            <button
              key={classId}
              type="button"
              disabled={!isLive}
              onClick={() => isLive && onSelect(classId as PvpEventClassId)}
              className={`ascension-chip-frame block w-full text-center ${isLive ? 'is-interactive' : 'opacity-50'}`}
            >
              <span className="ascension-chip-inner flex flex-col items-center gap-1 px-3 py-5">
                <span className="font-heading text-sm font-black uppercase tracking-wide text-gradient-steel">
                  {CLASS_DEFINITIONS[classId].displayName}
                </span>
                <span className="text-xs text-slate-400">{schedule}</span>
              </span>
            </button>
          )
        })}
      </div>
    </AscensionCard>
  )
}
