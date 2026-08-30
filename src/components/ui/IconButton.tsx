import type { ReactNode } from 'react'

// Small action-icon button (2026-11-16) — factored out of ZoneBossCard's
// inline trophy button so any future "small icon that opens something"
// affordance (leaderboards, help/info, etc.) shares one place to change the
// look, instead of every caller hand-rolling its own className string.
// `accent` picks a color family; add more here as new use cases need a
// color that doesn't already exist rather than inventing one-off classNames
// at the call site.
export type IconButtonAccent = 'amber' | 'sky'
// 'boxed' (default): the trophy button's original bordered/tinted-background
// tile. 'bare': just the accent-colored icon, no border/background — for
// appending inline next to text (e.g. a heading) rather than sitting in its
// own tile (2026-11-16, requested by the user for the rewards-help icon).
export type IconButtonVariant = 'boxed' | 'bare'

const ACCENT_TEXT: Record<IconButtonAccent, string> = {
  amber: 'text-amber-300',
  sky: 'text-sky-300',
}

const ACCENT_BOXED_CLASSES: Record<IconButtonAccent, string> = {
  // Matches the existing trophy-button convention (leaderboards, rewards).
  amber: `border-amber-500/40 bg-amber-500/10 ${ACCENT_TEXT.amber} hover:bg-amber-500/20`,
  // Distinct from amber so an info/help affordance never reads as "this is
  // about rewards" — sky is otherwise unused as a semantic color in this app.
  sky: `border-sky-500/40 bg-sky-500/10 ${ACCENT_TEXT.sky} hover:bg-sky-500/20`,
}

export function IconButton({
  icon,
  onClick,
  title,
  accent = 'amber',
  variant = 'boxed',
}: {
  // A plain emoji string (e.g. "🏆") or a ReactNode — pass an SVG icon
  // (stroke="currentColor") when an emoji's own baked-in color would fight
  // the `accent` above, e.g. HelpCircleIcon below instead of "❓" (renders
  // red/orange on most platforms' emoji sets, unrelated to any accent color
  // set here — the user flagged this exact clash).
  icon: ReactNode
  onClick: () => void
  title: string
  accent?: IconButtonAccent
  variant?: IconButtonVariant
}) {
  const className =
    variant === 'bare'
      ? `inline-flex shrink-0 items-center justify-center ${ACCENT_TEXT[accent]} hover:opacity-75`
      : `flex shrink-0 items-center justify-center rounded-lg border p-2 text-lg ${ACCENT_BOXED_CLASSES[accent]}`

  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={className}>
      {icon}
    </button>
  )
}

// Clean vector "?" — same monoline convention GameShell.tsx's own inline
// SVGs already use (24x24 viewBox, stroke="currentColor", strokeWidth 2,
// round caps/joins), so it inherits IconButton's accent text color instead
// of carrying its own fixed color the way an emoji glyph would. `className`
// overrides the default size for callers appending it inline next to text
// (a heading-sized icon reads as too dominant at the default boxed size).
export function HelpCircleIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}
