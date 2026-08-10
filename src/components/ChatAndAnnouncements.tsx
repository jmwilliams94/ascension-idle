import { useGlobalActivityStore } from '../game/social/useGlobalActivityStore'
import ChatButton from './ChatButton'
import GlobalAnnouncementTicker from './GlobalAnnouncementTicker'

// Groups the Chat button with the announcement ticker so they read as one
// connected unit in the top HUD strip, next to PlayersOnlineHud (requested
// by the user, 2026-08-18). A vertical divider only renders once there's
// actually an announcement to show next to Chat -- GlobalAnnouncementTicker
// itself renders nothing until the first announcement arrives (live, or
// seeded on connect by GlobalActivityConnection.tsx), so a bare trailing "|"
// with nothing after it would look broken.
export default function ChatAndAnnouncements() {
  const hasAnnouncement = useGlobalActivityStore((state) => state.latestAnnouncement !== null)

  return (
    <div className="flex min-w-0 shrink items-center gap-2">
      <ChatButton />
      {hasAnnouncement && (
        <span className="text-slate-700" aria-hidden="true">
          |
        </span>
      )}
      <GlobalAnnouncementTicker />
    </div>
  )
}
