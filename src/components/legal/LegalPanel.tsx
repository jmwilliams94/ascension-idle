import { useState } from 'react'
import PrivacyPolicyContent from './PrivacyPolicyContent'
import TermsContent from './TermsContent'

type LegalDocId = 'privacy' | 'terms'

// Settings > Legal tab (2026-09-01, requested by the user). Same two-pill
// toggle convention as BankPanel's Character/Account switch -- the two
// documents are long enough that showing both stacked at once would bury
// whichever one wasn't wanted, so only one renders at a time.
export default function LegalPanel({ initialDoc = 'privacy' }: { initialDoc?: LegalDocId }) {
  const [doc, setDoc] = useState<LegalDocId>(initialDoc)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { id: 'privacy', label: 'Privacy Policy' },
            { id: 'terms', label: 'Terms & Conditions' },
          ] as const
        ).map((tab) =>
          doc === tab.id ? (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDoc(tab.id)}
              className="rounded-xl border border-slate-300 bg-slate-300/10 px-3 py-2 font-heading text-xs font-bold uppercase tracking-[0.08em] text-slate-100"
            >
              {tab.label}
            </button>
          ) : (
            <div key={tab.id} className="ascension-chip-frame is-interactive">
              <button
                type="button"
                onClick={() => setDoc(tab.id)}
                className="ascension-chip-inner w-full px-3 py-2 font-heading text-xs font-bold uppercase tracking-[0.08em] text-slate-300 hover:text-slate-100"
              >
                {tab.label}
              </button>
            </div>
          ),
        )}
      </div>

      {doc === 'privacy' ? <PrivacyPolicyContent /> : <TermsContent />}
    </div>
  )
}
