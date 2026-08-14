import type { SelectHTMLAttributes } from 'react'

/**
 * Wraps a real native <select> (keeps accessibility/functionality, including
 * per-<option> inline `style={{ color }}` used for level-diff coloring
 * elsewhere) in the gold/steel `.select-frame` chrome with a custom arrow
 * overlay, since a native select's own dropdown arrow can't be restyled
 * directly.
 */
export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select-frame relative rounded-lg">
      {/* bg set explicitly (not transparent) — some browsers render the
          native option-list popup using the <select>'s own computed
          background, so leaving it transparent can leave the popup
          unstyled/white even though the visible control looks fine. */}
      <select
        className={`w-full appearance-none bg-[#07090e] px-3 py-2 pr-8 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
        {...props}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[0.65rem] text-amber-400">▼</span>
    </div>
  )
}
