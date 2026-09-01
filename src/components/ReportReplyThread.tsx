import { useEffect, useState } from 'react'
import { useReportReplyStore, type ReportReply, type ReportReplyParentType } from '../game/reports/useReportReplyStore'

const MESSAGE_MAX_LENGTH = 1000

// Stable reference for the "not loaded yet" fallback -- a selector must
// return the same reference across calls when nothing has actually changed,
// since Zustand's useSyncExternalStore-based subscription compares snapshots
// by reference. `state.repliesByParentId[parentId] ?? []` would allocate a
// brand-new array every render while the key is still missing, which reads
// as "the store changed" on every single render and crashes with React
// error #185 (Maximum update depth exceeded) -- the same Zustand selector
// pitfall documented elsewhere in this project's notes.
const EMPTY_REPLIES: ReportReply[] = []

// Shared by BugReportPanel.tsx and SuggestionsPanel.tsx (2026-08-21,
// requested by the user) -- the underlying report_replies table and its
// RPCs are shared too (see useReportReplyStore.ts), so this is genuinely
// one feature, not two similar-looking ones duplicated per panel. Renders
// wherever a report/suggestion row is expanded, for both the submitting
// player and the admin — either side can post here regardless of the
// parent's current status (open or already resolved).
export default function ReportReplyThread({
  parentType,
  parentId,
  viewerRole,
  characterId,
}: {
  parentType: ReportReplyParentType
  parentId: string
  viewerRole: 'player' | 'admin'
  characterId?: string
}) {
  const replies = useReportReplyStore((state) => state.repliesByParentId[parentId] ?? EMPTY_REPLIES)
  const busy = useReportReplyStore((state) => state.busy)
  const loadReplies = useReportReplyStore((state) => state.loadReplies)
  const sendPlayerReply = useReportReplyStore((state) => state.sendPlayerReply)
  const sendAdminReply = useReportReplyStore((state) => state.sendAdminReply)

  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadReplies(parentType, parentId)
  }, [parentType, parentId, loadReplies])

  const handleSend = async () => {
    const trimmed = message.trim()
    if (!trimmed) {
      return
    }
    setError(null)
    const response =
      viewerRole === 'admin'
        ? await sendAdminReply(parentType, parentId, trimmed)
        : await sendPlayerReply(parentType, parentId, characterId ?? '', trimmed)

    if (response.ok) {
      setMessage('')
    } else {
      setError('Something went wrong sending that.')
    }
  }

  return (
    <div className="space-y-2">
      {replies.length > 0 && (
        <div className="space-y-1.5">
          {replies.map((reply) => (
            <div
              key={reply.id}
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                reply.author_type === 'admin'
                  ? 'border-sky-800 bg-sky-500/10 text-sky-100'
                  : 'border-slate-800 bg-slate-950/60 text-slate-300'
              }`}
            >
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                {reply.author_name} · {new Date(reply.created_at).toLocaleString()}
              </p>
              <p className="whitespace-pre-wrap">{reply.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, MESSAGE_MAX_LENGTH))}
          rows={2}
          placeholder="Reply…"
          className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-base text-slate-200"
        />
        <button
          type="button"
          disabled={!message.trim() || busy}
          onClick={() => void handleSend()}
          className="shrink-0 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}
