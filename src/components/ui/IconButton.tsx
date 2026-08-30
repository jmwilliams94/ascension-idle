// Small circular/rounded action-icon button (2026-11-16) — factored out of
// ZoneBossCard's inline trophy button so any future "small icon that opens
// something" affordance (leaderboards, help/info, etc.) shares one place to
// change the look, instead of every caller hand-rolling its own className
// string. `accent` picks a color family; add more here as new use cases
// need a color that doesn't already exist rather than inventing one-off
// classNames at the call site.
export type IconButtonAccent = 'amber' | 'sky'

const ACCENT_CLASSES: Record<IconButtonAccent, string> = {
  // Matches the existing trophy-button convention (leaderboards, rewards).
  amber: 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20',
  // Distinct from amber so an info/help affordance never reads as "this is
  // about rewards" — sky is otherwise unused as a semantic color in this app.
  sky: 'border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20',
}

export function IconButton({
  icon,
  onClick,
  title,
  accent = 'amber',
}: {
  icon: string
  onClick: () => void
  title: string
  accent?: IconButtonAccent
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`shrink-0 rounded-lg border p-2 text-lg ${ACCENT_CLASSES[accent]}`}
    >
      {icon}
    </button>
  )
}
