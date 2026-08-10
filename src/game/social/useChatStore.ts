import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Reactive display state for Global Chat (2026-08-18) -- the Realtime
// subscription itself lives on GlobalActivityConnection.tsx's existing
// 'global-activity' channel (same non-visual-component-owns-the-resource
// pattern as everything else there), this store just holds what's been seen
// so far. See ChatOverlay.tsx for the combined chat+announcement feed this
// backs.
export interface ChatMessage {
  id: string
  characterName: string
  message: string
  createdAt: string
}

const HISTORY_LIMIT = 50
// Soft cap on how many messages the store keeps in memory during a long
// session -- chat volume has no natural ceiling the way rare-event
// announcements do, so this is needed where global_announcements never
// bothered (see CLAUDE.md's "grows unbounded" precedent for that table).
const MESSAGE_CAP = 200

function toChatMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    characterName: row.character_name as string,
    message: row.message as string,
    createdAt: row.created_at as string,
  }
}

interface SendChatMessageResult {
  ok: boolean
  error?: string
  id?: string
  created_at?: string
}

interface ChatState {
  messages: ChatMessage[]
  loaded: boolean
  loading: boolean
  sending: boolean
  loadRecentMessages: () => Promise<void>
  // Called both by the realtime INSERT listener and (indirectly, via
  // loadRecentMessages) by the initial history fetch -- dedupes by id since
  // a message can arrive over realtime before the backfill query returns.
  addMessage: (message: ChatMessage) => void
  sendMessage: (characterId: string, message: string) => Promise<SendChatMessageResult>
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]))
  for (const m of incoming) {
    byId.set(m.id, m)
  }
  return Array.from(byId.values())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MESSAGE_CAP)
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loaded: false,
  loading: false,
  sending: false,

  loadRecentMessages: async () => {
    if (get().loaded || get().loading) {
      return
    }
    set({ loading: true })

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, character_name, message, created_at')
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)

    set({ loading: false, loaded: true })

    if (error) {
      console.error('Failed to load chat history', error)
      return
    }

    const fetched = (data ?? []).map((row) => toChatMessage(row as Record<string, unknown>))
    set((state) => ({ messages: mergeMessages(state.messages, fetched) }))
  },

  addMessage: (message) => {
    set((state) => ({ messages: mergeMessages(state.messages, [message]) }))
  },

  sendMessage: async (characterId, message) => {
    if (get().sending) {
      return { ok: false, error: 'rpc_failed' }
    }

    set({ sending: true })
    const { data, error } = await supabase.rpc('send_chat_message', {
      p_character_id: characterId,
      p_message: message,
    })
    set({ sending: false })

    if (error) {
      console.error('send_chat_message call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    return data as SendChatMessageResult
  },
}))

export { toChatMessage }
