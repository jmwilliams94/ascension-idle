import { WHATS_NEW_COLLAPSE_THRESHOLD, type ChangelogEntry } from '../lib/changelog'
import ChangelogEntries from './ChangelogEntries'

interface WhatsNewModalProps {
  entries: ChangelogEntry[]
  onDismiss: () => void
}

export default function WhatsNewModal({ entries, onDismiss }: WhatsNewModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">What's new</h2>
        <div className="mt-4">
          <ChangelogEntries entries={entries} collapseThreshold={WHATS_NEW_COLLAPSE_THRESHOLD} />
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-6 w-full rounded-lg border border-sky-500 bg-sky-500/10 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
