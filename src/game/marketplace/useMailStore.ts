import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'

// Mail (see CLAUDE.md's Marketplace section and
// supabase/migrations/20260802050000_add_marketplace.sql) — a lightweight
// delivery inbox. Every entry here always carries an item (never currency —
// sale proceeds credit the seller's wallet directly). Populated exclusively
// by the Marketplace RPCs (buy/end_marketplace_listing); this store never
// writes the mail table directly (no client insert/update/delete grant
// exists on it — only claim_mail can remove a row).
export type MailReason = 'purchase' | 'listing_cancelled' | 'listing_expired'

export interface MailEntry {
  id: string
  character_id: string
  item_id: string
  reason: MailReason
  created_at: string
  item?: ItemInstance
}

interface ClaimResult {
  ok: boolean
  error?: string
  item_id?: string
}

interface MailState {
  entries: MailEntry[]
  loaded: boolean
  busy: boolean
  loadMail: (characterId: string) => Promise<void>
  // Used by InventoryPanel's visibleItems filter — an item already re-owned
  // by this character via a purchase, or still owned from a returned
  // listing, stays hidden from Inventory until claimed.
  hasUnclaimedMail: (itemId: string) => boolean
  claim: (characterId: string, mailId: string) => Promise<ClaimResult>
}

export const useMailStore = create<MailState>((set, get) => ({
  entries: [],
  loaded: false,
  busy: false,

  loadMail: async (characterId) => {
    const { data, error } = await supabase
      .from('mail')
      .select('id, character_id, item_id, reason, created_at')
      .eq('character_id', characterId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to load mail', error)
      return
    }

    const entries = (data ?? []) as MailEntry[]
    const itemIds = [...new Set(entries.map((entry) => entry.item_id))]

    let hydrated = entries
    if (itemIds.length > 0) {
      const { data: items } = await supabase.from('item_instances').select('*').in('id', itemIds)
      const byId = new Map((items ?? []).map((item) => [item.id, item as ItemInstance]))
      hydrated = entries.map((entry) => ({ ...entry, item: byId.get(entry.item_id) }))
    }

    set({ entries: hydrated, loaded: true })
  },

  hasUnclaimedMail: (itemId) => get().entries.some((entry) => entry.item_id === itemId),

  claim: async (characterId, mailId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('claim_mail', { p_character_id: characterId, p_mail_id: mailId })
    set({ busy: false })

    if (error) {
      console.error('Claim mail call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ClaimResult

    if (result.ok) {
      const entry = get().entries.find((candidate) => candidate.id === mailId)
      // The item's owner_id is already this character (set at purchase time,
      // or never changed for a returned listing) — claiming just needs to
      // add it to the local Inventory cache and stop hiding it, no new
      // item_instances row to fetch beyond what's already in the entry.
      if (entry?.item) {
        useInventoryStore.getState().addItem(entry.item)
      }
      set((state) => ({ entries: state.entries.filter((candidate) => candidate.id !== mailId) }))
    }

    return result
  },
}))
