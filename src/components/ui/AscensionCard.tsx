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
   * 'large' (2026-08-14, requested by the user) is GameShell's single
   * page-identity ribbon (one per active tab — Idling/Equipment/Forge/
   * Market/Shop/Bank/Achievements/LuckyLad) — roughly doubled on desktop
   * (`lg`+) only; below that it renders at the exact same size as
   * 'default', per the user's explicit ask that every main-container title
   * match on mobile (Equipment's old 'default' mobile size was the
   * reference: "a great size for all the other mobile headings"). In-page
   * section titles (Zone & Monster, Storage, ...) always use 'default'.
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
      <div className={`ascension-card-inner ${title ? (isLarge ? 'pt-6 lg:pt-9' : 'pt-6') : ''} ${contentClassName}`}>
        {title && (
          <div className={`ascension-card-ribbon ${isLarge ? 'ascension-card-ribbon-lg' : ''}`}>
            <span className={`ascension-glow-pulse text-amber-400 ${isLarge ? 'text-xs lg:text-base' : 'text-xs'}`}>✦</span>
            <h3
              className={`font-heading text-gradient-steel whitespace-nowrap font-black uppercase tracking-[0.15em] ${
                isLarge ? 'text-sm lg:text-2xl' : 'text-sm'
              }`}
            >
              {title}
            </h3>
            <span className={`ascension-glow-pulse text-amber-400 ${isLarge ? 'text-xs lg:text-base' : 'text-xs'}`}>✦</span>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
