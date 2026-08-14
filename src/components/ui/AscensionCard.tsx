import type { ReactNode } from 'react'

interface AscensionCardProps {
  /** Floating ribbon title. Omit for a plain frame with no ribbon. */
  title?: ReactNode
  children: ReactNode
  /** Extra classes on the outer gradient-frame div (e.g. width/margin). */
  className?: string
  /** Overrides the inner panel's own padding (default `p-4`). */
  contentClassName?: string
}

/**
 * Shared gold/steel "ribbon" card chrome (2026-08-14 visual overhaul) —
 * replaces the old `rounded-2xl border border-slate-800 bg-slate-950/80 p-4`
 * pattern duplicated across panel files. See src/index.css's
 * `.ascension-card-frame`/`.ascension-card-inner`/`.ascension-card-ribbon`.
 */
export function AscensionCard({ title, children, className = '', contentClassName = 'p-4' }: AscensionCardProps) {
  return (
    <div className={`ascension-card-frame ${className}`}>
      <div className={`ascension-card-inner ${title ? 'pt-5' : ''} ${contentClassName}`}>
        {title && (
          <div className="ascension-card-ribbon">
            <span className="ascension-glow-pulse text-[0.7rem] text-amber-400">✦</span>
            <h3 className="font-heading text-gradient-steel whitespace-nowrap text-xs font-black uppercase tracking-[0.15em]">
              {title}
            </h3>
            <span className="ascension-glow-pulse text-[0.7rem] text-amber-400">✦</span>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
