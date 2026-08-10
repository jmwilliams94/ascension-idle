import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useGlobalActivityStore, type GlobalAnnouncement } from '../game/social/useGlobalActivityStore'
import { useAnnouncementHistoryStore } from '../game/social/useAnnouncementHistoryStore'
import { useChatStore, toChatMessage } from '../game/social/useChatStore'

function toAnnouncement(row: Record<string, unknown>): GlobalAnnouncement {
  return {
    id: row.id as string,
    kind: row.kind as string,
    characterName: row.character_name as string,
    message: row.message as string,
    createdAt: row.created_at as string,
  }
}

// Non-visual, mounted unconditionally in GameShell alongside CombatEngine --
// owns the single Realtime channel behind "Players Online", the global
// announcement ticker, and (2026-08-18) Global Chat (see CLAUDE.md's Global
// Activity section). One channel does all three jobs: Presence (keyed by
// account id, so multiple tabs/characters on one account count once) drives
// the online count, Postgres Changes on global_announcements (requires that
// table to be added to the supabase_realtime publication -- see the
// 20260808050000_global_announcements.sql migration) pushes new
// announcements live, and Postgres Changes on chat_messages (same
// requirement, see 20260818000000_global_chat.sql) pushes new chat messages
// live into useChatStore.
//
// Presence payload carries an `active` flag driven by document.visibilityState
// so a minimised/backgrounded tab doesn't count as "online" -- re-tracked
// (not a separate RPC/heartbeat) only on actual visibilitychange transitions,
// so this costs one Realtime presence message per idle/resume, not per-tick
// polling. onlineCount only counts keys with at least one active presence.
export default function GlobalActivityConnection({ accountId }: { accountId: string | undefined }) {
  const setOnlineCount = useGlobalActivityStore((state) => state.setOnlineCount)
  const setLatestAnnouncement = useGlobalActivityStore((state) => state.setLatestAnnouncement)
  const addAnnouncementHistoryEntry = useAnnouncementHistoryStore((state) => state.addEntry)
  const addChatMessage = useChatStore((state) => state.addMessage)

  useEffect(() => {
    if (!accountId) {
      return undefined
    }

    let cancelled = false
    let subscribed = false

    // Seed with whatever the most recent announcement already was, so a
    // client that connects between events isn't stuck showing nothing until
    // the next one fires.
    void supabase
      .from('global_announcements')
      .select('id, kind, character_name, message, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data && data.length > 0) {
          setLatestAnnouncement(toAnnouncement(data[0] as Record<string, unknown>))
        }
      })

    const channel = supabase.channel('global-activity', {
      config: { presence: { key: accountId } },
    })

    const trackPresence = () => {
      void channel.track({
        online_at: new Date().toISOString(),
        active: document.visibilityState !== 'hidden',
      })
    }

    const handleVisibilityChange = () => {
      if (subscribed) {
        trackPresence()
      }
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<{ active?: boolean }>>
        const activeCount = Object.values(state).filter((entries) =>
          entries.some((entry) => entry.active !== false),
        ).length
        setOnlineCount(activeCount)
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'global_announcements' },
        (payload) => {
          const announcement = toAnnouncement(payload.new as Record<string, unknown>)
          setLatestAnnouncement(announcement)
          addAnnouncementHistoryEntry(announcement)
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => addChatMessage(toChatMessage(payload.new as Record<string, unknown>)),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true
          trackPresence()
        }
      })

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      subscribed = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void supabase.removeChannel(channel)
    }
  }, [accountId, setOnlineCount, setLatestAnnouncement, addAnnouncementHistoryEntry, addChatMessage])

  return null
}
