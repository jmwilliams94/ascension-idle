import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'

// VIP automation settings (v1.108.0) — the first real payoff for VIP status
// (characters.vip_expires_at, groundwork-only since v1.107.0). Persisted via
// characters.vip_automation_settings jsonb, written only through the
// set_vip_automation_settings RPC (see the migration's own comment for why —
// this column sits outside characters' authenticated column-level UPDATE
// grant, same "RPC past the allowlist" precedent every column added since
// 20260821000000_lock_down_direct_table_writes.sql follows).
export type SalvageTier = 'tempered' | 'infused' | 'radiant' | 'ascended'
export type LiquidationPriority = 'bank_first' | 'salvage_first'

export interface VipAutomationSettings {
  autoSellOre: boolean
  // Normal-quality gear has no Salvage value (0 AP) and can't be Auto-Banked
  // unless it's separately been Composed above +0 — its only automatable fate
  // is a plain gold sale, so this is its own boolean rather than a minTier on
  // autoSalvage (which structurally excludes 'normal' — see qualifiesSalvage
  // in runVipAutomationPass.ts).
  autoSellGear: boolean
  autoSalvage: { enabled: boolean; minTier: SalvageTier }
  autoBank: { enabled: boolean; minLevel: number }
  priority: LiquidationPriority
  // Auto-drinks the best owned HP/Mana potion whenever that pool would drop
  // below 30% of max (2026-09-02) — see PotionAutoUseEngine.tsx (live play)
  // and resolve-combat/index.ts's own mirror (MP only — see that file's own
  // comment on why HP can't be represented the same way in the offline
  // model). Independent per kind since a player may only want one automated.
  autoUsePotions: { hp: boolean; mp: boolean }
  // Lets Forge (quality_upgrade/level_upgrade/master_forge_upgrade only —
  // not the Comet/Fallen Star Scroll batch paths, which spend a whole Scroll
  // unit directly and never touch loose currency) draw a shortfall straight
  // from the account Bank's points-style balance (bank_comets/
  // bank_fallen_stars, ensure_forge_currency SQL) instead of refusing the
  // upgrade when the character is out of loose units/Scrolls. Independent
  // per currency, same shape as autoUsePotions.
  autoUseBankMaterial: { comet: boolean; fallen_star: boolean }
}

const SALVAGE_TIERS: SalvageTier[] = ['tempered', 'infused', 'radiant', 'ascended']

export const DEFAULT_VIP_AUTOMATION_SETTINGS: VipAutomationSettings = {
  autoSellOre: false,
  autoSellGear: false,
  autoSalvage: { enabled: false, minTier: 'tempered' },
  autoBank: { enabled: false, minLevel: 1 },
  priority: 'bank_first',
  autoUsePotions: { hp: false, mp: false },
  autoUseBankMaterial: { comet: false, fallen_star: false },
}

// Tolerant of anything the column could contain — a brand-new character's
// '{}' default, a partially-shaped object from an older client version, or a
// genuinely malformed value — same defensive parsing shape useIdleModeStore's
// hydrate already uses for its own single string column.
function normalize(saved: unknown): VipAutomationSettings {
  if (!saved || typeof saved !== 'object') {
    return DEFAULT_VIP_AUTOMATION_SETTINGS
  }
  const raw = saved as Record<string, unknown>
  const autoSalvage = (raw.autoSalvage ?? {}) as Record<string, unknown>
  const autoBank = (raw.autoBank ?? {}) as Record<string, unknown>
  const autoUsePotions = (raw.autoUsePotions ?? {}) as Record<string, unknown>
  const autoUseBankMaterial = (raw.autoUseBankMaterial ?? {}) as Record<string, unknown>

  return {
    autoSellOre: raw.autoSellOre === true,
    autoSellGear: raw.autoSellGear === true,
    autoSalvage: {
      enabled: autoSalvage.enabled === true,
      minTier: SALVAGE_TIERS.includes(autoSalvage.minTier as SalvageTier) ? (autoSalvage.minTier as SalvageTier) : 'tempered',
    },
    autoBank: {
      enabled: autoBank.enabled === true,
      minLevel: Math.min(12, Math.max(1, Math.round(Number(autoBank.minLevel)) || 1)),
    },
    priority: raw.priority === 'salvage_first' ? 'salvage_first' : 'bank_first',
    autoUsePotions: {
      hp: autoUsePotions.hp === true,
      mp: autoUsePotions.mp === true,
    },
    autoUseBankMaterial: {
      comet: autoUseBankMaterial.comet === true,
      fallen_star: autoUseBankMaterial.fallen_star === true,
    },
  }
}

interface VipAutomationState {
  settings: VipAutomationSettings
  saving: boolean
  hydrate: (saved: unknown) => void
  updateSettings: (partial: Partial<VipAutomationSettings>) => Promise<void>
}

export const useVipAutomationStore = create<VipAutomationState>((set, get) => ({
  settings: DEFAULT_VIP_AUTOMATION_SETTINGS,
  saving: false,

  hydrate: (saved) => set({ settings: normalize(saved) }),

  updateSettings: async (partial) => {
    const characterId = useActiveCharacterStore.getState().characterId
    if (!characterId) {
      return
    }

    const current = get().settings
    const merged: VipAutomationSettings = {
      ...current,
      ...partial,
      autoSalvage: { ...current.autoSalvage, ...partial.autoSalvage },
      autoBank: { ...current.autoBank, ...partial.autoBank },
      autoUsePotions: { ...current.autoUsePotions, ...partial.autoUsePotions },
      autoUseBankMaterial: { ...current.autoUseBankMaterial, ...partial.autoUseBankMaterial },
    }

    // Optimistic local update, reconciled from the server's own cleaned/
    // clamped copy once the RPC responds — same convention resolveCombat.ts
    // established for every other server-authoritative write in this project.
    set({ settings: merged, saving: true })

    const { data, error } = await supabase.rpc('set_vip_automation_settings', {
      p_character_id: characterId,
      p_settings: merged,
    })
    set({ saving: false })

    if (error) {
      console.error('Failed to save VIP automation settings', error)
      return
    }

    const result = data as { ok: boolean; settings?: unknown }
    if (result.ok && result.settings) {
      set({ settings: normalize(result.settings) })
    }
  },
}))
