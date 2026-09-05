import type { CSSProperties } from 'react'
import { EventEmberBorder } from '../../game/hud/eventEmberBorder'

const TOP_HUNTER_TINT = '#84CC16'

// Rotating PvP Tournament champion badge (2026-09-05, requested by the
// user) — shown wherever the current champion's name appears: their own
// character screen (EquipmentPanel.tsx), Global Chat next to their name
// (ChatOverlay.tsx), and the "inspect gear" loadout modal opened from there
// (CharacterLoadoutModal.tsx). Purely presentational — which character (if
// any) currently holds the title is derived by useCurrentPvpChampion
// (usePvpTournamentStore.ts), not stored on this component. `compact` shrinks
// it to sit inline next to a chat name the same way the VIP crown icon does.
export function TopHunterBadge({ title = 'Top Hunter', compact = false, className = '' }: { title?: string; compact?: boolean; className?: string }) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="ascension-chip-frame is-tinted" style={{ '--ascension-tint': TOP_HUNTER_TINT } as CSSProperties}>
        <span
          className={`ascension-chip-inner flex items-center gap-1 whitespace-nowrap font-bold uppercase tracking-wide text-lime-100 ${
            compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'
          }`}
        >
          🏆 {title}
        </span>
      </span>
      <EventEmberBorder color="champion" seed={5} count={compact ? 10 : 16} />
    </span>
  )
}
