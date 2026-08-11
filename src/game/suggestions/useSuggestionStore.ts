import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import type { MailCurrencyType } from '../marketplace/useMailStore'

export type SuggestionStatus = 'open' | 'implemented' | 'rejected'

export interface Suggestion {
  id: string
  created_at: string
  character_id: string
  character_name: string
  description: string
  status: SuggestionStatus
  admin_comment: string | null
  resolved_at: string | null
  viewed_at: string | null
}

export interface SuggestionCurrencyReward {
  currencyType: MailCurrencyType
  amount: number
}

interface ActionResult {
  ok: boolean
  error?: string
}

interface SuggestionState {
  mySuggestions: Suggestion[]
  mySuggestionsLoaded: boolean
  allSuggestions: Suggestion[]
  allSuggestionsLoaded: boolean
  busy: boolean
  loadMySuggestions: (characterId: string) => Promise<void>
  loadAllSuggestions: () => Promise<void>
  submitSuggestion: (characterId: string, description: string) => Promise<ActionResult>
  resolveSuggestion: (
    suggestionId: string,
    status: 'implemented' | 'rejected',
    comment: string,
    rewards: SuggestionCurrencyReward[],
  ) => Promise<ActionResult>
  markSeen: (characterId: string) => Promise<void>
}

const SUGGESTION_COLUMNS =
  'id, created_at, character_id, character_name, description, status, admin_comment, resolved_at, viewed_at'

// Suggestions (2026-08-21, requested by the user) -- replaces the earlier
// To-Do board. Same shape as useBugReportStore.ts: players submit + see
// their own history, the admin account sees every suggestion across every
// account (RLS built on public.is_admin(), see
// supabase/migrations/20260821030000_suggestions_replace_todo.sql) and
// closes one out as Implemented or Rejected, optionally attaching a
// currency-only reward delivered through the existing Mail system.
export const useSuggestionStore = create<SuggestionState>((set, get) => ({
  mySuggestions: [],
  mySuggestionsLoaded: false,
  allSuggestions: [],
  allSuggestionsLoaded: false,
  busy: false,

  loadMySuggestions: async (characterId) => {
    const { data, error } = await supabase
      .from('suggestions')
      .select(SUGGESTION_COLUMNS)
      .eq('character_id', characterId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load own suggestions', error)
      return
    }

    set({ mySuggestions: (data ?? []) as Suggestion[], mySuggestionsLoaded: true })
  },

  // Reachable by any authenticated caller, but RLS means a non-admin gets
  // back only their own account's rows -- harmless, just not useful outside
  // the admin queue this actually powers.
  loadAllSuggestions: async () => {
    const { data, error } = await supabase
      .from('suggestions')
      .select(SUGGESTION_COLUMNS)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to load all suggestions', error)
      return
    }

    set({ allSuggestions: (data ?? []) as Suggestion[], allSuggestionsLoaded: true })
  },

  submitSuggestion: async (characterId, description) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('submit_suggestion', {
      p_character_id: characterId,
      p_description: description,
    })
    set({ busy: false })

    if (error) {
      console.error('Submit suggestion call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadMySuggestions(characterId)
    }
    return result
  },

  resolveSuggestion: async (suggestionId, status, comment, rewards) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('resolve_suggestion', {
      p_suggestion_id: suggestionId,
      p_status: status,
      p_comment: comment,
      p_rewards: rewards.map((reward) => ({ currency_type: reward.currencyType, amount: reward.amount })),
    })
    set({ busy: false })

    if (error) {
      console.error('Resolve suggestion call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadAllSuggestions()
    }
    return result
  },

  markSeen: async (characterId) => {
    const { error } = await supabase.rpc('mark_suggestions_seen', { p_character_id: characterId })
    if (error) {
      console.error('Mark suggestions seen call failed', error)
      return
    }
    set((state) => ({
      mySuggestions: state.mySuggestions.map((suggestion) =>
        suggestion.resolved_at && !suggestion.viewed_at ? { ...suggestion, viewed_at: new Date().toISOString() } : suggestion,
      ),
    }))
  },
}))

export function countOpenSuggestions(suggestions: Suggestion[]): number {
  return suggestions.filter((suggestion) => suggestion.status === 'open').length
}
