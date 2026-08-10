import { useChatOverlayStore } from '../game/social/useChatOverlayStore'

// Sits next to PlayersOnlineHud, connected by a divider to
// GlobalAnnouncementTicker (see ChatAndAnnouncements.tsx). Opens
// ChatOverlay.tsx, mounted unconditionally in GameShell alongside the other
// modals.
export default function ChatButton() {
  const openOverlay = useChatOverlayStore((state) => state.openOverlay)

  return (
    <button
      type="button"
      onClick={openOverlay}
      aria-label="Open global chat"
      title="Global Chat"
      className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur hover:border-slate-500 hover:text-slate-100"
    >
      <span aria-hidden="true">💬</span>
    </button>
  )
}
