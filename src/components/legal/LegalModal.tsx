import LegalPanel from './LegalPanel'
import { useLockBodyScroll } from '../../lib/useLockBodyScroll'

interface LegalModalProps {
  initialDoc: 'privacy' | 'terms'
  onClose: () => void
}

// Unauthenticated equivalent of Settings > Legal (LegalPanel.tsx) -- opened
// from LoginForm.tsx's footer links, before a player has an account or has
// signed in, so it can't live behind SettingsModal (which only mounts once
// there's an active character). Same backdrop/frame/scroll-lock convention
// as SettingsModal itself, just without the side-nav shell since there's
// only ever this one thing to show here.
export default function LegalModal({ initialDoc, onClose }: LegalModalProps) {
  useLockBodyScroll()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div className="ascension-card-frame w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="ascension-card-inner flex max-h-[85dvh] min-h-0 flex-col overflow-hidden p-3 sm:p-5">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Legal</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 transition hover:text-amber-300">
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <LegalPanel initialDoc={initialDoc} />
          </div>
        </div>
      </div>
    </div>
  )
}
