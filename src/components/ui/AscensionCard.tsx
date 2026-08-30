import type { ReactNode } from 'react'
import { EventEmberBorder } from '../../game/hud/eventEmberBorder'
import { eventBorderTintStyle } from '../../game/hud/eventEmberBorderData'
import type { EventEmberColor } from '../../game/hud/useEventEmberColor'

interface AscensionCardProps {
  /** Header-line title (gold rule flanking the text). Omit for a plain frame with no title. */
  title?: ReactNode
  children: ReactNode
  /** Extra classes on the outer gradient-frame div (e.g. width/margin). */
  className?: string
  /** Overrides the inner panel's own padding (default `p-4`). */
  contentClassName?: string
  /**
   * 'large' (2026-08-14, requested by the user) is GameShell's single
   * page-identity title (one per active tab — Idling/Equipment/Forge/
   * Market/Shop/Bank/Achievements/LuckyLad) — roughly doubled on desktop
   * (`lg`+) only; below that it renders at the exact same size as
   * 'default', per the user's explicit ask that every main-container title
   * match on mobile (Equipment's old 'default' mobile size was the
   * reference: "a great size for all the other mobile headings"). In-page
   * section titles (Zone & Monster, Storage, ...) always use 'default'.
   */
  titleSize?: 'default' | 'large'
  /**
   * Same border-ember effect as the Idling nav button/Events sub-tab button
   * (2026-10-11, requested by the user, extended to the Events tab's own
   * Zone Boss/Gold Donation cards) — null/undefined renders nothing.
   * EventEmberBorder's particles anchor outside their own parent's box by
   * design (see eventEmberBorder.tsx), which conflicts with
   * .ascension-card-frame's own clip-path chamfer (2026-08-28, Prism
   * Obsidian pass) — clipping the frame would cut the embers off. So
   * whenever this is set, the embers render as a sibling of the frame
   * (inside an unclipped wrapper) instead of a child of it, letting the
   * frame chamfer unconditionally either way. Only ZoneBossCard/
   * GoldDonationCard pass this today, and neither passes `className`.
   */
  activeEventColor?: EventEmberColor | null
}

/**
 * Shared gold/steel card chrome (2026-08-14 visual overhaul, title treatment
 * reworked 2026-08-28 to the Prism Obsidian in-flow header-line style) —
 * replaces the old `rounded-2xl border border-slate-800 bg-slate-950/80 p-4`
 * pattern duplicated across panel files. See src/index.css's
 * `.ascension-card-frame`/`.ascension-card-inner`/`.ascension-card-header`.
 */
export function AscensionCard({
  title,
  children,
  className = '',
  contentClassName = 'p-4',
  titleSize = 'default',
  activeEventColor = null,
}: AscensionCardProps) {
  const isLarge = titleSize === 'large'

  const content = (
    <div className={`ascension-card-inner ${contentClassName}`}>
      {title && (
        <div className={`ascension-card-header ${isLarge ? 'ascension-card-header-lg' : ''}`}>
          <span className="ascension-card-header-line" />
          <h3
            className={`font-heading text-gradient-steel whitespace-nowrap font-black uppercase tracking-[0.15em] ${
              isLarge ? 'text-sm lg:text-2xl' : 'text-sm'
            }`}
          >
            {title}
          </h3>
          <span className="ascension-card-header-line" />
        </div>
      )}
      {children}
    </div>
  )

  if (activeEventColor) {
    // `w-full` only, not `h-full` — the wrapper's height must stay
    // content-driven (auto) so EventEmberBorder's percentage-based anchors
    // (positioned against this wrapper, since it's the frame's nearest
    // `relative` ancestor) still hug the frame's actual visible edges. A
    // forced `h-full` used to also stretch to fill whatever height a CSS
    // Grid parent handed this column (align-items: stretch is the grid
    // default) — harmless for ZoneBossCard, whose content roughly fills that
    // height anyway, but blew GoldDonationCard's finished-event state up to
    // match its much-taller Inventory-panel sibling (reported by the user,
    // screenshot showed a mostly-empty card). Neither card actually needs
    // the two to match heights — they're always stacked vertically, never
    // side-by-side.
    return (
      <div className={`relative w-full ${className}`}>
        <div className="ascension-card-frame w-full" style={eventBorderTintStyle(activeEventColor)}>
          {content}
        </div>
        <EventEmberBorder color={activeEventColor} />
      </div>
    )
  }

  return <div className={`ascension-card-frame ${className}`}>{content}</div>
}
