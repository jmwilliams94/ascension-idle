import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import type { MailCurrencyType } from '../marketplace/useMailStore'

// Admin Mail (2026-08-13, requested by the user) — thin wrapper around the
// two admin-only RPCs (supabase/migrations/20260813100000_admin_mail.sql).
// Real enforcement is server-side (both RPCs independently compare
// auth.uid() against a hardcoded admin email) — this store doesn't need to
// re-check anything, a non-admin caller just gets back {ok:false,
// error:'not_admin'}.
export type AdminMailReward =
  | { kind: 'currency'; currencyType: MailCurrencyType; amount: number }
  | { kind: 'item'; templateId: string; qualityTier: string; compositionLevel: number }

interface SendMailResult {
  ok: boolean
  error?: string
  batch_id?: string
  recipient_count?: number
}

interface LookupCharacterResult {
  ok: boolean
  error?: string
  id?: string
  name?: string
  class?: string
  level?: number
}

interface AdminMailState {
  busy: boolean
  sendMail: (target: string, message: string, rewards: AdminMailReward[]) => Promise<SendMailResult>
  lookupCharacter: (name: string) => Promise<LookupCharacterResult>
}

function toRewardJson(reward: AdminMailReward): Record<string, unknown> {
  return reward.kind === 'currency'
    ? { type: 'currency', currency_type: reward.currencyType, amount: reward.amount }
    : { type: 'item', template_id: reward.templateId, quality_tier: reward.qualityTier, composition_level: reward.compositionLevel }
}

export const useAdminMailStore = create<AdminMailState>((set) => ({
  busy: false,

  sendMail: async (target, message, rewards) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('admin_send_mail', {
      p_target: target,
      p_message: message,
      p_rewards: rewards.map(toRewardJson),
    })
    set({ busy: false })

    if (error) {
      console.error('Admin send mail call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    return data as SendMailResult
  },

  lookupCharacter: async (name) => {
    const { data, error } = await supabase.rpc('admin_lookup_character', { p_name: name })

    if (error) {
      console.error('Admin lookup character call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    return data as LookupCharacterResult
  },
}))
