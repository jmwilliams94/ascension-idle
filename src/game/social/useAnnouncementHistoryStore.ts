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
}

const HISTORY_LIMIT = 10

export const useAnnouncementHistoryStore = create<AnnouncementHistoryState>((set, get) => ({
  entries: [],
  loaded: false,
  loading: false,

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
