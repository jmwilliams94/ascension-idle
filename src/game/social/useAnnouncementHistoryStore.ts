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

// Milestone kinds (2026-08-15) -- excluded from the rotating last-10 history
// below entirely, and shown instead as a permanent pinned section in
// ChatOverlay (see milestoneEntries/loadMilestones below). Reaching the
// level cap is rare and significant enough that it shouldn't compete for one
// of only 10 slots against routine Lucky Lad/armor-socket announcements and
// get scrolled out of view within minutes (confirmed with the user,
// 2026-08-15) -- currently just level_130, but kept as a set/array so a
// future hyper-rare milestone kind can join it without a schema change.
const MILESTONE_KINDS = new Set(['level_130'])

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
  // explicit loadHistory() fetch already uses. A MILESTONE_KINDS entry is
  // silently ignored here -- GlobalActivityConnection routes those to
  // addMilestoneEntry instead, never into this rotating list.
  addEntry: (entry: AnnouncementHistoryEntry) => void
  // Permanent, un-rotating record of milestone-kind announcements (see
  // MILESTONE_KINDS) -- pinned in ChatOverlay above the scrolling feed
  // rather than living/dying by the same 10-slot cap as everything else.
  // Unbounded (no .slice cap): these are rare enough by design that
  // unbounded growth isn't a real concern, unlike the routine-announcement
  // list above.
  milestoneEntries: AnnouncementHistoryEntry[]
  milestonesLoaded: boolean
  loadingMilestones: boolean
  loadMilestones: () => Promise<void>
  addMilestoneEntry: (entry: AnnouncementHistoryEntry) => void
}

const HISTORY_LIMIT = 10

export const useAnnouncementHistoryStore = create<AnnouncementHistoryState>((set, get) => ({
  entries: [],
  loaded: false,
  loading: false,
  milestoneEntries: [],
  milestonesLoaded: false,
  loadingMilestones: false,

  addEntry: (entry) => {
    if (MILESTONE_KINDS.has(entry.kind)) {
      return
    }
    set((state) => ({
      entries: [entry, ...state.entries.filter((e) => e.id !== entry.id)].slice(0, HISTORY_LIMIT),
    }))
  },

  addMilestoneEntry: (entry) => {
    if (!MILESTONE_KINDS.has(entry.kind)) {
      return
    }
    set((state) => ({
      // Chronological (oldest first), matching loadMilestones' own order --
      // reads like a hall-of-fame list rather than a most-recent-first feed.
      milestoneEntries: [...state.milestoneEntries.filter((e) => e.id !== entry.id), entry],
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
      .not('kind', 'in', `(${[...MILESTONE_KINDS].join(',')})`)
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

  loadMilestones: async () => {
    if (get().loadingMilestones) {
      return
    }
    set({ loadingMilestones: true })

    const { data, error } = await supabase
      .from('global_announcements')
      .select('id, kind, character_name, message, created_at')
      .in('kind', [...MILESTONE_KINDS])
      .order('created_at', { ascending: true })

    set({ loadingMilestones: false, milestonesLoaded: true })

    if (error) {
      console.error('Failed to load milestone announcements', error)
      return
    }

    set({
      milestoneEntries: (data ?? []).map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        characterName: row.character_name as string,
        message: row.message as string,
        createdAt: row.created_at as string,
      })),
    })
  },
}))
