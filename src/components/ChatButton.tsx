import { useMemo } from 'react'
import { useChatOverlayStore } from '../game/social/useChatOverlayStore'
import { useChatStore } from '../game/social/useChatStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'

// Sits next to PlayersOnlineHud, connected by a divider to
// GlobalAnnouncementTicker (see ChatAndAnnouncements.tsx). Opens
// ChatOverlay.tsx, mounted unconditionally in GameShell alongside the other
// modals.
export default function ChatButton() {
  const openOverlay = useChatOverlayStore((state) => state.openOverlay)
  const messages = useChatStore((state) => state.messages)
  const lastReadAt = useChatStore((state) => state.lastReadAt)
  const activeCharacterName = useCharacterRecordStore((state) => state.characterName)

  // Unread bubble (2026-08-18, requested by the user) -- same small count
  // pill TabNav.tsx already uses for Achievements/Mail. Excludes the active
  // character's own messages (matched by name, same imperfect-but-good-enough
  // comparison ChatOverlay already uses to highlight "your" messages) so
  // sending a message doesn't immediately show a "+1" against yourself.
  const unreadCount = useMemo(
    () =>
      messages.filter(
        (m) => (!lastReadAt || m.createdAt > lastReadAt) && m.characterName !== activeCharacterName,
      ).length,
    [messages, lastReadAt, activeCharacterName],
  )

  return (
    <button
      type="button"
      onClick={openOverlay}
      aria-label="Open global chat"
      title="Global Chat"
      className="relative shrink-0 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur hover:border-slate-500 hover:text-slate-100"
    >
      <span aria-hidden="true">💬</span>
      {Boolean(unreadCount) && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
