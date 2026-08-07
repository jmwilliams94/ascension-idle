import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useGlobalActivityStore, type GlobalAnnouncement } from '../game/social/useGlobalActivityStore'

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
// owns the single Realtime channel behind "Players Online" + the global
// announcement ticker (see CLAUDE.md's Global Activity section). One
// channel does both jobs: Presence (keyed by account id, so multiple tabs/
// characters on one account count once) drives the online count, and
// Postgres Changes on global_announcements (requires that table to be added
// to the supabase_realtime publication -- see the
// 20260808050000_global_announcements.sql migration) pushes new
// announcements live.
export default function GlobalActivityConnection({ accountId }: { accountId: string | undefined }) {
  const setOnlineCount = useGlobalActivityStore((state) => state.setOnlineCount)
  const setLatestAnnouncement = useGlobalActivityStore((state) => state.setLatestAnnouncement)

  useEffect(() => {
    if (!accountId) {
      return undefined
    }

    let cancelled = false

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

    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineCount(Object.keys(channel.presenceState()).length)
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'global_announcements' },
        (payload) => setLatestAnnouncement(toAnnouncement(payload.new as Record<string, unknown>)),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ online_at: new Date().toISOString() })
        }
      })

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [accountId, setOnlineCount, setLatestAnnouncement])

  return null
}
