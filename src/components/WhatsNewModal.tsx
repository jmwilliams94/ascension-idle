import { WHATS_NEW_COLLAPSE_THRESHOLD, type ChangelogEntry } from '../lib/changelog'
import ChangelogEntries from './ChangelogEntries'
import { Button } from './ui/Button'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'

interface WhatsNewModalProps {
  entries: ChangelogEntry[]
  onDismiss: () => void
}

export default function WhatsNewModal({ entries, onDismiss }: WhatsNewModalProps) {
  useLockBodyScroll()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="ascension-card-frame w-full max-w-lg">
        <div className="ascension-card-inner max-h-[80vh] overflow-y-auto p-6">
          <h2 className="text-lg font-semibold text-white">What's new</h2>
          <div className="mt-4">
            <ChangelogEntries entries={entries} collapseThreshold={WHATS_NEW_COLLAPSE_THRESHOLD} />
          </div>
          <Button variant="primary" onClick={onDismiss} className="mt-6 w-full">
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}
