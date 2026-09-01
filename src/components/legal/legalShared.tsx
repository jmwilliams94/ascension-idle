import type { ReactNode } from 'react'

// Shared plain-text building blocks for the Privacy Policy/Terms content
// (LegalPanel.tsx's Settings tab, LegalModal.tsx's unauthenticated login-page
// modal) -- both read from the same section data so the two surfaces can
// never drift out of sync with each other.
export interface LegalSection {
  heading: string
  body: ReactNode
}

export function LegalDoc({ title, lastUpdated, intro, sections }: { title: string; lastUpdated: string; intro?: ReactNode; sections: LegalSection[] }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-400">Ascension Idle — Last updated {lastUpdated}</p>

      {intro && <div className="mt-3 space-y-2">{intro}</div>}

      <div className="mt-4 space-y-5">
        {sections.map((section) => (
          <div key={section.heading}>
            <h3 className="mb-1.5 text-sm font-semibold text-slate-100">{section.heading}</h3>
            <div className="space-y-2">{section.body}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate-300">{children}</p>
}

export function Ul({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed text-slate-300">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span className="text-slate-400">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-sm leading-relaxed text-slate-300">{children}</div>
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-sky-400 underline hover:text-sky-300">
      {children}
    </a>
  )
}

export function EmailLink({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className="text-sky-400 underline hover:text-sky-300">
      {address}
    </a>
  )
}
