import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Backs GlobalAnnouncementTicker.tsx's "See more" history dropdown
// (2026-08-11) — a genuinely global feed (every account's recent activity,
// not scoped to the viewer), unlike an earlier same-day draft of this
// feature that scoped it to "my own wins" before the user redirected it:
// "I want players to see what other people have gotten recently." Reuses
// global_announcements directly (already public-select RLS, no new schema)
// with no kind filter at all — covers both armor-socket procs and every
// announced Lucky Lad tier together, one combined feed.
export interface AnnouncementHistoryEntry {
  id: string
  kind: string
  characterName: string
  message: string
  createdAt: string
}

interface AnnouncementHistoryState {
  entries: AnnouncementHistoryEntry[]
  loaded: boolean
  loading: boolean
  loadHistory: () => Promise<void>
  // Live-append for a fresh announcement pushed over Realtime (2026-08-18,
  // added alongside Global Chat) -- GlobalActivityConnection.tsx calls this
  // next to its existing setLatestAnnouncement call, so both the ticker's
  // "See more" dropdown and ChatOverlay's combined feed stay current without
  // an extra reload. Dedupes by id and keeps the same HISTORY_LIMIT cap the
  // explicit loadHistory() fetch already uses.
  addEntry: (entry: AnnouncementHistoryEntry) => void
}

const HISTORY_LIMIT = 10

export const useAnnouncementHistoryStore = create<AnnouncementHistoryState>((set, get) => ({
  entries: [],
  loaded: false,
  loading: false,

  addEntry: (entry) => {
    set((state) => ({
      entries: [entry, ...state.entries.filter((e) => e.id !== entry.id)].slice(0, HISTORY_LIMIT),
    }))
  },

  loadHistory: async () => {
    if (get().loading) {
      return
    }
    set({ loading: true })

    const { data, error } = await supabase
      .from('global_announcements')
      .select('id, kind, character_name, message, created_at')
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)

    set({ loading: false, loaded: true })

    if (error) {
      console.error('Failed to load global announcement history', error)
      return
    }

    set({
      entries: (data ?? []).map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        characterName: row.character_name as string,
        message: row.message as string,
        createdAt: row.created_at as string,
      })),
    })
  },
}))
