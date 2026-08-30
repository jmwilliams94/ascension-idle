import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useGlobalActivityStore, type GlobalAnnouncement } from '../game/social/useGlobalActivityStore'
import { useAnnouncementHistoryStore } from '../game/social/useAnnouncementHistoryStore'
import { useChatStore, toChatMessage } from '../game/social/useChatStore'
import { useSessionConflictStore } from '../game/social/useSessionConflictStore'
import { useTabActivityStore } from '../lib/useTabActivityStore'
import { getTabSessionId } from '../lib/tabSessionId'

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
  const addMilestoneEntry = useAnnouncementHistoryStore((state) => state.addMilestoneEntry)
  const addChatMessage = useChatStore((state) => state.addMessage)
  // Identifies this tab within its own account's presence entries, so a
  // second session for the same account can be told apart from this one --
  // see the session-conflict handling below and useSessionConflictStore.ts.
  const sessionIdRef = useRef(getTabSessionId())

  useEffect(() => {
    if (!accountId) {
      return undefined
    }

    let cancelled = false
    let subscribed = false
    let hasCheckedConflict = false

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

    // Lets SessionConflictModal (which has no access to this closure's
    // channel) ask this tab to broadcast an eviction on its behalf. Also
    // claims the account's server-side current_session_id (see the
    // 20261119000000_resolve_combat_session_fencing.sql migration) -- the
    // broadcast alone only stops the other tab if it's actively connected
    // and processes the message right then; claiming here means resolve-
    // combat itself will refuse that other session's calls going forward
    // even if the broadcast is missed entirely (reported by the user: an old
    // session kept earning real rewards after "Sign Out Other Session" was
    // clicked, because its tab never received the broadcast).
    useSessionConflictStore.getState().setRequestEvictOthers((targetSessionIds) => {
      void channel.send({ type: 'broadcast', event: 'session-evicted', payload: { targetSessionIds } })
      void supabase.rpc('claim_account_session', { p_session_id: sessionIdRef.current })
    })

    const trackPresence = () => {
      void channel.track({
        online_at: new Date().toISOString(),
        active: document.visibilityState !== 'hidden',
        session_id: sessionIdRef.current,
      })
    }

    const handleVisibilityChange = () => {
      if (subscribed) {
        trackPresence()
      }
    }

    // Closing the tab only reliably drops presence via visibilitychange/the
    // socket's own disconnect detection on a genuinely clean close -- the
    // server otherwise has to fall back to its heartbeat timeout, which can
    // take anywhere from instant to tens of seconds depending on exactly how
    // the browser tears the connection down, reading as "sometimes updates,
    // sometimes doesn't" (reported by the user 2026-08-17). `pagehide` fires
    // reliably on tab/browser close (unlike `beforeunload`, which is flakier
    // and also hurts bfcache eligibility) and gives an explicit leave signal
    // for this channel's topic, so a normal close reports offline right away
    // instead of waiting on connection-loss detection.
    const handlePageHide = () => {
      void supabase.removeChannel(channel)
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<{ active?: boolean; session_id?: string }>>
        const activeCount = Object.values(state).filter((entries) =>
          entries.some((entry) => entry.active !== false),
        ).length
        setOnlineCount(activeCount)

        // One-shot: only the first sync after this tab connects reflects
        // whatever was already present for this account, so this only ever
        // fires for a session that predates this one -- later syncs are
        // driven by unrelated players elsewhere on the same shared channel
        // and shouldn't re-open a prompt the player already resolved.
        if (!hasCheckedConflict) {
          hasCheckedConflict = true
          const otherSessionIds = (state[accountId] ?? [])
            .map((entry) => entry.session_id)
            .filter((id): id is string => !!id && id !== sessionIdRef.current)
          if (otherSessionIds.length > 0) {
            useSessionConflictStore.getState().setOtherSessions(otherSessionIds)
          } else {
            // No conflict -- this tab is (as far as presence can tell) the
            // only session, so it claims the account's server-side
            // current_session_id itself. Covers both a genuinely first
            // session and a fresh tab opened after a previous one closed
            // uncleanly (crash, killed process) without ever releasing its
            // presence -- either way, nothing else will ever reclaim this on
            // this tab's behalf, and skipping it would leave resolve-combat
            // permanently fencing this tab out against a stale id from a
            // session that no longer exists.
            void supabase.rpc('claim_account_session', { p_session_id: sessionIdRef.current })
          }
        }
      })
      .on('broadcast', { event: 'session-evicted' }, ({ payload }) => {
        const targetSessionIds = (payload?.targetSessionIds ?? []) as string[]
        if (targetSessionIds.includes(sessionIdRef.current)) {
          useSessionConflictStore.getState().setEvictedByOther()
        }
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'global_announcements' },
        (payload) => {
          const announcement = toAnnouncement(payload.new as Record<string, unknown>)
          setLatestAnnouncement(announcement)
          // Milestone kinds (level_130) are routed to the permanent pinned
          // list instead of the rotating last-10 -- each store's own guard
          // (MILESTONE_KINDS) makes exactly one of these two calls a no-op.
          addAnnouncementHistoryEntry(announcement)
          addMilestoneEntry(announcement)
          useTabActivityStore.getState().markPending()
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
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      cancelled = true
      subscribed = false
      useSessionConflictStore.getState().setRequestEvictOthers(null)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      void supabase.removeChannel(channel)
    }
  }, [accountId, setOnlineCount, setLatestAnnouncement, addAnnouncementHistoryEntry, addMilestoneEntry, addChatMessage])

  return null
}
