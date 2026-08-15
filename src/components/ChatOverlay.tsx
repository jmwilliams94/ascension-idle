import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useChatOverlayStore } from '../game/social/useChatOverlayStore'
import { useChatStore } from '../game/social/useChatStore'
import { useAnnouncementHistoryStore } from '../game/social/useAnnouncementHistoryStore'
import { useCharacterLoadoutStore } from '../game/social/useCharacterLoadoutStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'

interface FeedItem {
  id: string
  createdAt: string
  characterName: string
  message: string
  kind: 'chat' | 'announcement'
}

const ERROR_MESSAGES: Record<string, string> = {
  message_too_long: 'That message is too long (280 characters max).',
  empty_message: 'Type something first.',
  rate_limited: 'Slow down a little.',
  not_owner: 'Something went wrong sending that.',
  rpc_failed: 'Message failed to send.',
}

// SettingsModal-style fixed-backdrop popup (same pattern as MailDetailModal),
// mounted unconditionally in GameShell (2026-08-18). Combines chat_messages
// with global_announcements into one chronological feed -- CLAUDE.md's
// Global Activity section covers why these stay two separate tables even
// though they render together here (the ticker itself must stay
// announcement-only). GlobalActivityConnection.tsx keeps both stores fed
// live even while this overlay is closed, so reopening it never needs a
// fresh network round trip beyond the one-time initial history backfill.
export default function ChatOverlay({ characterId }: { characterId: string }) {
  const open = useChatOverlayStore((state) => state.open)
  const closeOverlay = useChatOverlayStore((state) => state.closeOverlay)

  const messages = useChatStore((state) => state.messages)
  const chatLoaded = useChatStore((state) => state.loaded)
  const loadRecentMessages = useChatStore((state) => state.loadRecentMessages)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const sending = useChatStore((state) => state.sending)
  const markAllRead = useChatStore((state) => state.markAllRead)

  const announcementEntries = useAnnouncementHistoryStore((state) => state.entries)
  const announcementLoaded = useAnnouncementHistoryStore((state) => state.loaded)
  const loadAnnouncementHistory = useAnnouncementHistoryStore((state) => state.loadHistory)
  // Milestone announcements (level 130 and any future cap-style kind) are
  // pinned above the scrolling feed instead of living inside it -- confirmed
  // with the user, 2026-08-15: a level-cap achievement is significant enough
  // that it shouldn't be able to scroll out of view just because chat/other
  // announcements kept happening after it.
  const milestoneEntries = useAnnouncementHistoryStore((state) => state.milestoneEntries)
  const milestonesLoaded = useAnnouncementHistoryStore((state) => state.milestonesLoaded)
  const loadMilestones = useAnnouncementHistoryStore((state) => state.loadMilestones)

  const activeCharacterName = useCharacterRecordStore((state) => state.characterName)
  const viewCharacter = useCharacterLoadoutStore((state) => state.viewCharacter)

  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    if (!chatLoaded) {
      void loadRecentMessages()
    }
    if (!announcementLoaded) {
      void loadAnnouncementHistory()
    }
    if (!milestonesLoaded) {
      void loadMilestones()
    }
  }, [open, chatLoaded, announcementLoaded, milestonesLoaded, loadRecentMessages, loadAnnouncementHistory, loadMilestones])

  const feed = useMemo<FeedItem[]>(() => {
    const chatItems: FeedItem[] = messages.map((m) => ({
      id: `chat-${m.id}`,
      createdAt: m.createdAt,
      characterName: m.characterName,
      message: m.message,
      kind: 'chat',
    }))
    const announcementItems: FeedItem[] = announcementEntries.map((a) => ({
      id: `announcement-${a.id}`,
      createdAt: a.createdAt,
      characterName: a.characterName,
      message: a.message,
      kind: 'announcement',
    }))
    return [...chatItems, ...announcementItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [messages, announcementEntries])

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }
  }, [feed.length, open])

  // Marks everything read on open, and again whenever a new message arrives
  // while still open -- so the badge stays clear the whole time the overlay
  // is visible, and only starts accumulating again once it's closed.
  useEffect(() => {
    if (open) {
      markAllRead()
    }
  }, [open, messages.length, markAllRead])

  if (!open) {
    return null
  }

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || sending) {
      return
    }
    setError(null)
    const result = await sendMessage(characterId, trimmed)
    if (result.ok) {
      setDraft('')
    } else {
      setError(ERROR_MESSAGES[result.error ?? 'rpc_failed'] ?? ERROR_MESSAGES.rpc_failed)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={closeOverlay}>
      <div
        className="flex h-[min(80vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">Global Chat</h2>
          <button
            type="button"
            onClick={closeOverlay}
            aria-label="Close chat"
            className="text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {milestoneEntries.length > 0 && (
          <div className="max-h-24 shrink-0 space-y-1 overflow-y-auto border-b border-amber-600/30 bg-amber-500/10 px-4 py-2">
            {milestoneEntries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs font-medium text-amber-200">
                <span aria-hidden="true">🏆</span>
                <span className="min-w-0 flex-1 break-words">{entry.message}</span>
              </div>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
          {feed.length === 0 ? (
            <p className="text-sm text-slate-500">
              {chatLoaded ? 'No messages yet — say something!' : 'Loading…'}
            </p>
          ) : (
            feed.map((item) =>
              item.kind === 'announcement' ? (
                <div
                  key={item.id}
                  className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
                >
                  <span aria-hidden="true">📣</span>
                  <span className="min-w-0 flex-1 break-words">{item.message}</span>
                </div>
              ) : (
                <div key={item.id} className="text-sm text-slate-200">
                  <button
                    type="button"
                    onClick={() => viewCharacter(item.characterName)}
                    title="Inspect gear"
                    className={`mr-1 inline-block rounded-full border px-1.5 py-0.5 align-middle text-xs font-semibold ${
                      item.characterName === activeCharacterName
                        ? 'border-sky-700/60 bg-sky-500/10 text-sky-300 hover:border-sky-400'
                        : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                    }`}
                  >
                    {item.characterName}
                  </button>
                  <span className="break-words">{item.message}</span>
                </div>
              ),
            )
          )}
        </div>

        {error && <p className="px-4 pb-1 text-xs text-rose-400">{error}</p>}

        <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-slate-800 px-3 py-3">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 280))}
            placeholder="Say something…"
            maxLength={280}
            // text-base (16px), not text-sm -- iOS/mobile browsers auto-zoom
            // the viewport on focus for any text input under 16px, which is
            // what the user was seeing here (reported 2026-08-18).
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-base text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
