import type { ReactNode } from 'react'

interface AscensionCardProps {
  /** Floating ribbon title. Omit for a plain frame with no ribbon. */
  title?: ReactNode
  children: ReactNode
  /** Extra classes on the outer gradient-frame div (e.g. width/margin). */
  className?: string
  /** Overrides the inner panel's own padding (default `p-4`). */
  contentClassName?: string
  /**
   * 'large' (2026-08-14, requested by the user) roughly doubles the ribbon
   * title's size and re-spaces the ribbon/content padding to match — for
   * one-per-tab page-identity headers (LuckyLad, Forge, Market, Shop, Bank)
   * rather than the smaller in-page section titles (Zone & Monster, Storage,
   * Achievements, ...), which stay 'default'.
   */
  titleSize?: 'default' | 'large'
}

/**
 * Shared gold/steel "ribbon" card chrome (2026-08-14 visual overhaul) —
 * replaces the old `rounded-2xl border border-slate-800 bg-slate-950/80 p-4`
 * pattern duplicated across panel files. See src/index.css's
 * `.ascension-card-frame`/`.ascension-card-inner`/`.ascension-card-ribbon`.
 */
export function AscensionCard({ title, children, className = '', contentClassName = 'p-4', titleSize = 'default' }: AscensionCardProps) {
  const isLarge = titleSize === 'large'

  return (
    <div className={`ascension-card-frame ${className}`}>
      <div className={`ascension-card-inner ${title ? (isLarge ? 'pt-9' : 'pt-6') : ''} ${contentClassName}`}>
        {title && (
          <div className={`ascension-card-ribbon ${isLarge ? 'ascension-card-ribbon-lg' : ''}`}>
            <span className={`ascension-glow-pulse text-amber-400 ${isLarge ? 'text-base' : 'text-xs'}`}>✦</span>
            <h3
              className={`font-heading text-gradient-steel whitespace-nowrap font-black uppercase tracking-[0.15em] ${
                isLarge ? 'text-2xl' : 'text-sm'
              }`}
            >
              {title}
            </h3>
            <span className={`ascension-glow-pulse text-amber-400 ${isLarge ? 'text-base' : 'text-xs'}`}>✦</span>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
