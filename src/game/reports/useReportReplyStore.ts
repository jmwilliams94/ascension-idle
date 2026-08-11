import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

export type ReportReplyParentType = 'bug' | 'suggestion'

export interface ReportReply {
  id: string
  created_at: string
  bug_report_id: string | null
  suggestion_id: string | null
  author_type: 'player' | 'admin'
  author_name: string
  message: string
}

interface ActionResult {
  ok: boolean
  error?: string
}

interface ReportReplyState {
  repliesByParentId: Record<string, ReportReply[]>
  busy: boolean
  loadReplies: (parentType: ReportReplyParentType, parentId: string) => Promise<void>
  sendPlayerReply: (
    parentType: ReportReplyParentType,
    parentId: string,
    characterId: string,
    message: string,
  ) => Promise<ActionResult>
  sendAdminReply: (parentType: ReportReplyParentType, parentId: string, message: string) => Promise<ActionResult>
}

const REPLY_COLUMNS = 'id, created_at, bug_report_id, suggestion_id, author_type, author_name, message'

// Reply threads (2026-08-21, requested by the user) -- lets a player and the
// admin go back and forth on an individual Suggestion or Bug Report, rather
// than the one-shot admin_comment set only at close time. One shared table
// (report_replies) backs both parent types (see
// supabase/migrations/20260821040000_report_reply_threads.sql) -- this store
// is used by both BugReportPanel.tsx and SuggestionsPanel.tsx through the
// shared ReportReplyThread.tsx component, keyed by parentType so the right
// column/RPC is used under the hood.
export const useReportReplyStore = create<ReportReplyState>((set, get) => ({
  repliesByParentId: {},
  busy: false,

  loadReplies: async (parentType, parentId) => {
    const column = parentType === 'bug' ? 'bug_report_id' : 'suggestion_id'
    const { data, error } = await supabase
      .from('report_replies')
      .select(REPLY_COLUMNS)
      .eq(column, parentId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to load report replies', error)
      return
    }

    set((state) => ({ repliesByParentId: { ...state.repliesByParentId, [parentId]: (data ?? []) as ReportReply[] } }))
  },

  sendPlayerReply: async (parentType, parentId, characterId, message) => {
    set({ busy: true })
    const { data, error } =
      parentType === 'bug'
        ? await supabase.rpc('reply_to_bug_report', { p_character_id: characterId, p_report_id: parentId, p_message: message })
        : await supabase.rpc('reply_to_suggestion', {
            p_character_id: characterId,
            p_suggestion_id: parentId,
            p_message: message,
          })
    set({ busy: false })

    if (error) {
      console.error('Send reply call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadReplies(parentType, parentId)
    }
    return result
  },

  sendAdminReply: async (parentType, parentId, message) => {
    set({ busy: true })
    const { data, error } =
      parentType === 'bug'
        ? await supabase.rpc('admin_reply_bug_report', { p_report_id: parentId, p_message: message })
        : await supabase.rpc('admin_reply_suggestion', { p_suggestion_id: parentId, p_message: message })
    set({ busy: false })

    if (error) {
      console.error('Send admin reply call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadReplies(parentType, parentId)
    }
    return result
  },
}))
