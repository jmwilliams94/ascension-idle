import { useState } from 'react'
import { Button } from './ui/Button'
import LegalModal from './legal/LegalModal'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'
import { useAuthStore } from '../lib/useAuthStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'

interface TermsAcceptanceModalProps {
  userId: string
}

// First-login legal gate (App.tsx renders this whenever
// termsAcceptedVersion !== LEGAL_VERSION -- see usePlayerRecordStore.ts). Shown
// once per account: every account created before this feature shipped has a
// null terms_accepted_version too, so existing players see it once on their
// next login same as new signups. Declining just signs the player out rather
// than trapping them here -- there's no obligation to let someone use a free
// service without agreeing to its terms, but there's also no reason to hold
// the tab hostage over it.
export default function TermsAcceptanceModal({ userId }: TermsAcceptanceModalProps) {
  useLockBodyScroll()
  const acceptTerms = usePlayerRecordStore((state) => state.acceptTerms)

  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAccept = acceptedTerms && acceptedPrivacy && !submitting

  const handleAccept = async () => {
    if (!canAccept) return
    setSubmitting(true)
    setError(null)

    const ok = await acceptTerms(userId)

    setSubmitting(false)
    if (!ok) {
      setError('Something went wrong saving that. Please try again.')
    }
  }

  const handleDecline = () => {
    void useAuthStore.getState().signOut('local')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="ascension-card-frame w-full max-w-md">
        <div className="ascension-card-inner max-h-[85dvh] overflow-y-auto p-6">
          <h2 className="text-lg font-semibold text-white">Before you play</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Please review and accept our Terms &amp; Conditions and Privacy Policy to continue. You only need to do this
            once.
          </p>

          <div className="mt-5 space-y-3">
            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-400"
              />
              <span>
                I have read and agree to the{' '}
                <button
                  type="button"
                  onClick={() => setLegalDoc('terms')}
                  className="text-sky-400 underline hover:text-sky-300"
                >
                  Terms &amp; Conditions
                </button>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={acceptedPrivacy}
                onChange={(event) => setAcceptedPrivacy(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-400"
              />
              <span>
                I have read and agree to the{' '}
                <button
                  type="button"
                  onClick={() => setLegalDoc('privacy')}
                  className="text-sky-400 underline hover:text-sky-300"
                >
                  Privacy Policy
                </button>
              </span>
            </label>
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <Button variant="primary" disabled={!canAccept} onClick={handleAccept} className="mt-6 w-full">
            {submitting ? 'Saving…' : 'Accept & Continue'}
          </Button>

          <button
            type="button"
            onClick={handleDecline}
            className="mt-3 w-full text-center text-xs text-slate-500 transition hover:text-slate-300"
          >
            I don&apos;t accept — sign out
          </button>
        </div>
      </div>

      {legalDoc && <LegalModal initialDoc={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  )
}
