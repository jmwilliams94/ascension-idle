import type { CSSProperties } from 'react'
import { EventEmberBorder } from '../../game/hud/eventEmberBorder'
import { championEmberColor, EVENT_EMBER_HEX } from '../../game/hud/eventEmberBorderData'

// Rotating PvP Tournament champion badge (2026-09-05, requested by the
// user) — shown wherever the current champion's name appears: their own
// character screen (EquipmentPanel.tsx), Global Chat next to their name
// (ChatOverlay.tsx), and the "inspect gear" loadout modal opened from there
// (CharacterLoadoutModal.tsx). Purely presentational — which character (if
// any) currently holds the title is derived by useCurrentPvpChampion
// (usePvpTournamentStore.ts), not stored on this component. `compact` shrinks
// it to sit inline next to a chat name the same way the VIP crown icon does.
//
// Per-class tint (2026-09-06, requested by the user — "Top Hunter and Top
// Wuxia have their own designs"): color is derived from the title text
// itself rather than a separate classId prop, since champion_title
// ('Top Hunter' / 'Top Wuxia', see 20261225000000_pvp_per_class_tournaments.sql)
// is the only signal every call site actually has in hand — GlobalAnnouncementTicker
// parses it out of a plain-text announcement message with no classId available at all.
export function TopHunterBadge({ title = 'Top Hunter', compact = false, className = '' }: { title?: string; compact?: boolean; className?: string }) {
  const emberColor = championEmberColor(title)
  const isWuxia = emberColor === 'championWuxia'
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="ascension-chip-frame is-tinted" style={{ '--ascension-tint': EVENT_EMBER_HEX[emberColor] } as CSSProperties}>
        <span
          className={`ascension-chip-inner flex items-center gap-1 whitespace-nowrap font-bold uppercase tracking-wide ${
            isWuxia ? 'text-blue-100' : 'text-lime-100'
          } ${compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'}`}
        >
          🏆 {title}
        </span>
      </span>
      <EventEmberBorder color={emberColor} seed={5} count={compact ? 10 : 16} />
    </span>
  )
}
