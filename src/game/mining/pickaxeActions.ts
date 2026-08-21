import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useGemStore } from '../items/useGemStore'
import type { GemCounts } from '../items/gemCatalog'
import { usePickaxeStore } from './usePickaxeStore'
import type { PickaxeTierName } from './pickaxeCosts'
import type { GemTypeId } from '../items/gemCatalog'

export interface PickaxeTierUpgradeResult {
  ok: boolean
  error?: string
  template_id?: string
  name?: string
  gold_spent?: number
  gold_remaining?: number
  gems?: GemCounts
  ascended_gem_type?: string | null
}

// Guaranteed-success tier-up — see pickaxe_tier_upgrade (SQL). Gold is
// applied as a negative delta via addRewards, the same convention sellItem
// uses for a gold-only change (no EXP touched); gems overwrite wholesale
// from the RPC's own authoritative post-spend snapshot, same as every other
// gem-spending action (enchant_item_hp/bless_item/socket_gem's client call
// sites).
export async function tierUpgradePickaxe(characterId: string): Promise<PickaxeTierUpgradeResult> {
  const { data, error } = await supabase.rpc('pickaxe_tier_upgrade', { character_id: characterId })

  if (error) {
    console.error('pickaxe_tier_upgrade call failed', error)
    return { ok: false, error: 'call_failed' }
  }

  const result = data as PickaxeTierUpgradeResult

  if (result.ok && result.name) {
    const ascendedGemType = result.ascended_gem_type !== undefined ? (result.ascended_gem_type as GemTypeId | null) : undefined
    usePickaxeStore.getState().applyTierUpgrade(result.name as PickaxeTierName, ascendedGemType)
    if (typeof result.gold_spent === 'number' && result.gold_spent > 0) {
      useProgressionStore.getState().addRewards(-result.gold_spent, 0)
    }
    if (result.gems) {
      useGemStore.getState().setGems(result.gems)
    }
  }

  return result
}
