import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import type { MailCurrencyType } from '../marketplace/useMailStore'

export type BugReportStatus = 'open' | 'fixed' | 'rewarded'

export interface BugReport {
  id: string
  created_at: string
  character_id: string
  character_name: string
  description: string
  status: BugReportStatus
  admin_comment: string | null
  resolved_at: string | null
  viewed_at: string | null
}

export interface BugReportCurrencyReward {
  currencyType: MailCurrencyType
  amount: number
}

interface ActionResult {
  ok: boolean
  error?: string
}

interface BugReportState {
  myReports: BugReport[]
  myReportsLoaded: boolean
  allReports: BugReport[]
  allReportsLoaded: boolean
  busy: boolean
  loadMyReports: (characterId: string) => Promise<void>
  loadAllReports: () => Promise<void>
  submitReport: (characterId: string, description: string) => Promise<ActionResult>
  resolveReport: (
    reportId: string,
    status: 'fixed' | 'rewarded',
    comment: string,
    rewards: BugReportCurrencyReward[],
  ) => Promise<ActionResult>
  markSeen: (characterId: string) => Promise<void>
}

const REPORT_COLUMNS = 'id, created_at, character_id, character_name, description, status, admin_comment, resolved_at, viewed_at'

// Bug Reports (2026-08-21, requested by the user) -- players submit a report
// against their active character and can see their own report history; only
// the admin account can see every report across every account (additive
// RLS, same OR'd-policies pattern as marketplace_listings' actively-listed
// items -- see the migration) and close one out as Fixed/Rewarded with a
// comment, optionally attaching a currency-only reward delivered through the
// existing Mail system (resolve_bug_report inserts straight into `mail` --
// no new claim path needed client-side, useMailStore's existing claim()
// picks it up like any other mail row). Deliberately no gear/weapon reward
// path here, unlike Admin Mail (see useAdminMailStore.ts).
export const useBugReportStore = create<BugReportState>((set, get) => ({
  myReports: [],
  myReportsLoaded: false,
  allReports: [],
  allReportsLoaded: false,
  busy: false,

  loadMyReports: async (characterId) => {
    const { data, error } = await supabase
      .from('bug_reports')
      .select(REPORT_COLUMNS)
      .eq('character_id', characterId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load own bug reports', error)
      return
    }

    set({ myReports: (data ?? []) as BugReport[], myReportsLoaded: true })
  },

  // Reachable by any authenticated caller, but RLS means a non-admin gets
  // back only their own account's rows (same rows loadMyReports would
  // return, just unfiltered by character) -- harmless, just not useful
  // outside the admin queue this actually powers.
  loadAllReports: async () => {
    const { data, error } = await supabase
      .from('bug_reports')
      .select(REPORT_COLUMNS)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to load all bug reports', error)
      return
    }

    set({ allReports: (data ?? []) as BugReport[], allReportsLoaded: true })
  },

  submitReport: async (characterId, description) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('submit_bug_report', {
      p_character_id: characterId,
      p_description: description,
    })
    set({ busy: false })

    if (error) {
      console.error('Submit bug report call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadMyReports(characterId)
    }
    return result
  },

  resolveReport: async (reportId, status, comment, rewards) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('resolve_bug_report', {
      p_report_id: reportId,
      p_status: status,
      p_comment: comment,
      p_rewards: rewards.map((reward) => ({ currency_type: reward.currencyType, amount: reward.amount })),
    })
    set({ busy: false })

    if (error) {
      console.error('Resolve bug report call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadAllReports()
    }
    return result
  },

  markSeen: async (characterId) => {
    const { error } = await supabase.rpc('mark_bug_reports_seen', { p_character_id: characterId })
    if (error) {
      console.error('Mark bug reports seen call failed', error)
      return
    }
    set((state) => ({
      myReports: state.myReports.map((report) =>
        report.resolved_at && !report.viewed_at ? { ...report, viewed_at: new Date().toISOString() } : report,
      ),
    }))
  },
}))

export function countOpenBugReports(reports: BugReport[]): number {
  return reports.filter((report) => report.status === 'open').length
}
