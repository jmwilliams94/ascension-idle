import { useState } from 'react'
import { useSessionConflictStore } from '../game/social/useSessionConflictStore'
import { useAuthStore } from '../lib/useAuthStore'

// Shown when this tab detects (via global-activity's Presence sync, see
// GlobalActivityConnection.tsx) that another session for this account is
// already live. Deliberately not backdrop-dismissable to a no-op -- both
// choices below resolve to exactly one active session, so there's no way to
// leave this open and end up with two sessions still polling combat.
export default function SessionConflictModal() {
  const otherSessionIds = useSessionConflictStore((state) => state.otherSessionIds)
  const requestEvictOthers = useSessionConflictStore((state) => state.requestEvictOthers)
  const clearOtherSessions = useSessionConflictStore((state) => state.clearOtherSessions)
  const [busy, setBusy] = useState(false)

  if (!otherSessionIds || otherSessionIds.length === 0) {
    return null
  }

  const handleEvictOther = () => {
    requestEvictOthers?.(otherSessionIds)
    clearOtherSessions()
  }

  const handleCancel = async () => {
    setBusy(true)
    await useAuthStore.getState().signOut()
    clearOtherSessions()
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={() => void handleCancel()}>
      <div
        className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm text-slate-200">
          Another session for this account is <span className="font-semibold text-amber-300">already active</span>. Sign
          it out to continue here, or cancel to leave it running.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleEvictOther}
            className="flex-1 rounded-lg border border-amber-500 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sign Out Other Session & Continue
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCancel()}
            className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-300 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : 'Cancel & Return to Login'}
          </button>
        </div>
      </div>
    </div>
  )
}
