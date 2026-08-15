import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import type { ListableCurrencyType } from './useMarketplaceStore'

// Admin Mail (2026-08-13) adds two currency kinds that are mail-claimable but
// deliberately NOT marketplace-listable (Lottery Tickets/Ascension Points
// aren't tradeable items) — kept as a separate superset type so
// ListableCurrencyType (which also governs what a player can list for sale)
// stays untouched. 'gold' (added for World Boss rewards, migration
// 20260826000000_add_world_boss.sql) is the same story — Mail-claimable, never
// marketplace-listable, since Marketplace/Shop gold proceeds always credit
// characters.gold directly instead of routing through Mail.
export type MailCurrencyType = ListableCurrencyType | 'lottery_ticket' | 'ascension_points' | 'gold'

// Mail (see CLAUDE.md's Marketplace section and
// supabase/migrations/20260802050000_add_marketplace.sql). Sale proceeds
// (Gold/Ascension Points) still credit the seller's wallet directly, but as
// of 2026-08-03 an entry here can now carry a listable currency unit
// (Comet/Fallen Star/their Scrolls) instead of a gear item — exactly one of
// item_id/currency_type is set per row (DB check constraint), same split as
// marketplace_listings itself. Populated exclusively by the Marketplace RPCs
// (buy/end_marketplace_listing); this store never writes the mail table
// directly (no client insert/update/delete grant exists on it — only
// claim_mail can remove a row).
export type MailReason = 'purchase' | 'listing_cancelled' | 'listing_expired'

export type MailReasonExtended = MailReason | 'admin_gift' | 'bug_report_reward'

export interface MailEntry {
  id: string
  character_id: string
  item_id: string | null
  currency_type: MailCurrencyType | null
  reason: MailReasonExtended
  created_at: string
  item?: ItemInstance
  // Admin Mail only (2026-08-13, migration 20260813100000_admin_mail.sql) —
  // null for every pre-existing marketplace-generated row. Several rows
  // sharing the same mail_batch_id were all inserted by one admin send and
  // carry identical sender_label/message — MailTab groups them into a single
  // card rather than rendering one card per row (see that component).
  mail_batch_id: string | null
  sender_label: string | null
  message: string | null
  // Currency rows only — how many units this one row grants on claim
  // (null means 1, for every pre-existing row that predates this column).
  amount: number | null
  // Admin Mail only (migration 20260813100000_admin_mail.sql's sender_label/
  // message, this one added 20260813110000_mail_history.sql) — a real
  // subject line, separate from `message`, the admin composer fills in.
  // Null for every Market-originated row (purchase/listing_cancelled/
  // listing_expired) — MailTab falls back to reasonLabel(reason) for those.
  subject: string | null
  // Set once a claim succeeds (20260813110000_mail_history.sql) — claiming
  // no longer deletes the row, it marks this instead, so claimed mail stays
  // visible as history until clear_mail_history removes it. Null means
  // still unclaimed (this is what hides an item from Inventory and counts
  // toward the "unread mail" nav badges — see hasUnclaimedMail/
  // countUnreadMail below).
  claimed_at: string | null
}

// A "group" is either one ungrouped row (pre-existing marketplace mail,
// batchId null) or every row sharing one mail_batch_id (one Admin Mail send
// — see admin_send_mail in supabase/migrations/20260813100000_admin_mail.sql).
// Exported so both MailTab (rendering) and the nav badges (TabNav.tsx/
// MobileBottomNav.tsx, 2026-08-13 fix) can count "unread mail" the same way
// — a 9-item admin gift is 1 unread mail, not 9.
export interface MailGroup {
  key: string
  batchId: string | null
  entries: MailEntry[]
}

export function groupMailEntries(entries: MailEntry[]): MailGroup[] {
  const batchIndex = new Map<string, number>()
  const groups: MailGroup[] = []

  for (const entry of entries) {
    if (entry.mail_batch_id) {
      const existingIndex = batchIndex.get(entry.mail_batch_id)
      if (existingIndex === undefined) {
        batchIndex.set(entry.mail_batch_id, groups.length)
        groups.push({ key: entry.mail_batch_id, batchId: entry.mail_batch_id, entries: [entry] })
      } else {
        groups[existingIndex].entries.push(entry)
      }
    } else {
      groups.push({ key: entry.id, batchId: null, entries: [entry] })
    }
  }

  return groups
}

// "Unread" = still-unclaimed mail, grouped the same way the row list groups
// it — a 9-reward admin gift is 1 unread mail, not 9 (2026-08-13 fix, see
// groupMailEntries's own comment). Single source of truth for both nav
// badges (TabNav.tsx/MobileBottomNav.tsx) and MarketplacePanel's own Mail
// sub-tab pill, which had drifted out of sync with the nav fix before.
export function countUnreadMail(entries: MailEntry[]): number {
  return groupMailEntries(entries.filter((entry) => entry.claimed_at === null)).length
}

interface ClaimResult {
  ok: boolean
  error?: string
  item_id?: string
  currency_type?: MailCurrencyType
  new_count?: number
  claimed_at?: string
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
  // Player-facing (any character can clear their own — clear_mail_history's
  // real guard is ownership, not admin). Only ever removes already-claimed
  // rows server-side; local state mirrors that by keeping every still-
  // unclaimed entry.
  clearHistory: (characterId: string) => Promise<{ ok: boolean; error?: string; cleared_count?: number }>
}

export const useMailStore = create<MailState>((set, get) => ({
  entries: [],
  loaded: false,
  busy: false,

  loadMail: async (characterId) => {
    const { data, error } = await supabase
      .from('mail')
      .select(
        'id, character_id, item_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message, claimed_at, created_at',
      )
      .eq('character_id', characterId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to load mail', error)
      return
    }

    const entries = (data ?? []) as MailEntry[]
    const itemIds = [...new Set(entries.map((entry) => entry.item_id).filter((id): id is string => id !== null))]

    let hydrated = entries
    if (itemIds.length > 0) {
      const { data: items } = await supabase.from('item_instances').select('*').in('id', itemIds)
      const byId = new Map((items ?? []).map((item) => [item.id, item as ItemInstance]))
      hydrated = entries.map((entry) => ({ ...entry, item: entry.item_id ? byId.get(entry.item_id) : undefined }))
    }

    set({ entries: hydrated, loaded: true })
  },

  hasUnclaimedMail: (itemId) => get().entries.some((entry) => entry.item_id === itemId && entry.claimed_at === null),

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

      if (result.currency_type && typeof result.new_count === 'number') {
        // Unlike a gear item (already owned, claiming just stops hiding it),
        // a currency unit's actual increment happens server-side right at
        // this claim — reflect whatever the RPC returned into the matching
        // count, same "read the response, never assume" trust model every
        // other currency mutation in this game already uses.
        const currencyStore = useCurrencyStore.getState()
        switch (result.currency_type) {
          case 'comet':
            currencyStore.setComets(result.new_count)
            break
          case 'fallen_star':
            currencyStore.setFallenStars(result.new_count)
            break
          case 'comet_scroll':
            currencyStore.setCometScrolls(result.new_count)
            break
          case 'fallen_star_scroll':
            currencyStore.setFallenStarScrolls(result.new_count)
            break
          case 'lottery_ticket':
            currencyStore.setLotteryTickets(result.new_count)
            break
          case 'ascension_points':
            usePlayerRecordStore.getState().setAscensionPoints(result.new_count)
            break
          case 'gold':
            useProgressionStore.getState().setGold(result.new_count)
            break
        }
      } else if (entry?.item) {
        // The item's owner_id is already this character (set at purchase
        // time, or never changed for a returned listing) — claiming just
        // needs to add it to the local Inventory cache and stop hiding it,
        // no new item_instances row to fetch beyond what's already in the
        // entry.
        useInventoryStore.getState().addItem(entry.item)
      }

      // Marks claimed rather than removing (2026-08-13, mail is now
      // browsable history) — reads claimed_at off the response, same "read
      // the response, never assume" trust model as new_count above, rather
      // than stamping a locally-guessed timestamp.
      set((state) => ({
        entries: state.entries.map((candidate) =>
          candidate.id === mailId ? { ...candidate, claimed_at: result.claimed_at ?? new Date().toISOString() } : candidate,
        ),
      }))
    }

    return result
  },

  clearHistory: async (characterId) => {
    const { data, error } = await supabase.rpc('clear_mail_history', { p_character_id: characterId })

    if (error) {
      console.error('Clear mail history call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as { ok: boolean; error?: string; cleared_count?: number }

    if (result.ok) {
      // The RPC only ever deletes claimed_at-is-not-null rows server-side —
      // mirror exactly that here rather than clearing everything.
      set((state) => ({ entries: state.entries.filter((entry) => entry.claimed_at === null) }))
    }

    return result
  },
}))
