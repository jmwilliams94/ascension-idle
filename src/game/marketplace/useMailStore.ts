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
// characters.gold directly instead of routing through Mail. 'comet_box'
// (added for the World Boss/Gold Donation reward overhaul,
// 20260904000000_event_reward_overhaul.sql) is the same story — Mail-
// claimable, never marketplace-listable. 'vip_token' (groundwork only) is
// the same story too — Admin Mail can grant it, but it's never a
// marketplace-listable currency type.
export type MailCurrencyType = ListableCurrencyType | 'lottery_ticket' | 'ascension_points' | 'gold' | 'comet_box' | 'vip_token'

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

export type MailReasonExtended =
  | MailReason
  | 'admin_gift'
  | 'bug_report_reward'
  | 'suggestion_reward'
  | 'world_boss_reward'
  | 'gold_donation_reward'
  | 'sale_notification'

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
  // Item snapshot (20260907000000_mail_item_snapshot_and_resell_fix.sql) —
  // what the item looked like at the moment it was mailed, captured by
  // buy_marketplace_listing/end_marketplace_listing/admin_send_mail. Null
  // for item_id === null rows and for any row mailed before this migration.
  // Preferred over the live `item` join for display so a mail history entry
  // doesn't keep changing appearance as the player later Forges/levels/
  // requalitys the item after claiming it — same idea as
  // marketplace_listings' own item_* snapshot (see MarketplacePanel.tsx's
  // mailSnapshotItem).
  item_template_id: string | null
  item_quality_tier: string | null
  item_level: number | null
  item_composition_level: number | null
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

const MAIL_SELECT_COLUMNS =
  'id, character_id, item_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message, claimed_at, created_at, item_template_id, item_quality_tier, item_level, item_composition_level'

// Caps how much *claimed* history loadMail pulls in (2026-08-28, reported by
// the user — an account that never clears its mail history eventually stops
// being able to open the detail overlay at all, no console error, root cause
// never pinned down beyond "hundreds of accumulated rows"; clearing history
// was the workaround). Unclaimed mail is never capped — those are real
// un-granted rewards and must always load in full — only old, already-claimed
// history is bounded, same "don't let unbounded lifetime history keep
// growing the working set forever" idea as LOOT_HOLDING_CAP. Known edge case:
// a batch claimed partway then abandoned, with its claimed rows aging past
// this cap while an unclaimed sibling row remains, would render that group
// missing its older reward tiles — accepted, since it only affects very old
// partial claims, not the common case this fixes.
const MAIL_HISTORY_LIMIT = 100

export const useMailStore = create<MailState>((set, get) => ({
  entries: [],
  loaded: false,
  busy: false,

  loadMail: async (characterId) => {
    const [unclaimedResult, historyResult] = await Promise.all([
      supabase.from('mail').select(MAIL_SELECT_COLUMNS).eq('character_id', characterId).is('claimed_at', null),
      supabase
        .from('mail')
        .select(MAIL_SELECT_COLUMNS)
        .eq('character_id', characterId)
        .not('claimed_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MAIL_HISTORY_LIMIT),
    ])

    if (unclaimedResult.error || historyResult.error) {
      console.error('Failed to load mail', unclaimedResult.error ?? historyResult.error)
      return
    }

    const entries = [...((unclaimedResult.data ?? []) as MailEntry[]), ...((historyResult.data ?? []) as MailEntry[])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
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
          case 'comet_box':
            currencyStore.setCometBoxes(result.new_count)
            break
          case 'vip_token':
            currencyStore.setVipTokens(result.new_count)
            break
        }
      } else if (entry?.item) {
        // The item's owner_id is already this character (set at purchase
        // time, or never changed for a returned listing) — claiming just
        // needs to add it to the local Inventory cache and stop hiding it,
        // no new item_instances row to fetch beyond what's already in the
        // entry.
        useInventoryStore.getState().addItem(entry.item)
      } else if (entry?.reason === 'sale_notification') {
        // Sale proceeds (Gold or Ascension Points) were already credited
        // directly to the seller by buy_marketplace_listing at sale time —
        // this message-only row (no item_id/currency_type) carries nothing
        // to grant, so claim_mail's response has no new_count to read.
        // Without this, the balance change was already sitting in the DB
        // but the seller's client wouldn't show it until a full reload
        // (reported by the user, 2026-08-17) — fetch both live values now so
        // clicking Claim actually reflects the gain immediately.
        const { data: characterRow } = await supabase
          .from('characters')
          .select('gold, account_id')
          .eq('id', characterId)
          .maybeSingle()
        if (characterRow) {
          useProgressionStore.getState().setGold(characterRow.gold)
          const { data: playerRow } = await supabase
            .from('players')
            .select('ascension_points')
            .eq('id', characterRow.account_id)
            .maybeSingle()
          if (playerRow) {
            usePlayerRecordStore.getState().setAscensionPoints(playerRow.ascension_points)
          }
        }
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
