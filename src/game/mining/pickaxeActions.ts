import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useGemStore } from '../items/useGemStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useCharacterRecordStore } from '../../lib/useCharacterRecordStore'
import type { GemCounts } from '../items/gemCatalog'

export interface PickaxeTierUpgradeResult {
  ok: boolean
  error?: string
  item_id?: string
  template_id?: string
  level?: number
  name?: string
  gold_spent?: number
  gold_remaining?: number
  gems?: GemCounts
  ascended_gem_type?: string | null
}

// Guaranteed-success tier-up — see pickaxe_tier_upgrade (SQL). Pickaxe is a
// normal Main Hand weapon now (requested by the user), so this patches the
// equipped item's local cache (template_id/level) directly rather than a
// separate pickaxe store — same idiom every other Forge upgrade RPC's client
// call site already uses (see useForgeStore). Gold is applied as a negative
// delta via addRewards, the same convention sellItem uses for a gold-only
// change (no EXP touched); gems overwrite wholesale from the RPC's own
// authoritative post-spend snapshot, same as every other gem-spending
// action (enchant_item_hp/bless_item/socket_gem's client call sites).
export async function tierUpgradePickaxe(characterId: string): Promise<PickaxeTierUpgradeResult> {
  const { data, error } = await supabase.rpc('pickaxe_tier_upgrade', { character_id: characterId })

  if (error) {
    console.error('pickaxe_tier_upgrade call failed', error)
    return { ok: false, error: 'call_failed' }
  }

  const result = data as PickaxeTierUpgradeResult

  if (result.ok && result.item_id && result.template_id) {
    useInventoryStore.getState().patchItem(result.item_id, {
      template_id: result.template_id,
      ...(typeof result.level === 'number' ? { level: result.level } : {}),
    })
    if (typeof result.gold_spent === 'number' && result.gold_spent > 0) {
      useProgressionStore.getState().addRewards(-result.gold_spent, 0)
    }
    if (result.gems) {
      useGemStore.getState().setGems(result.gems)
    }
    if (result.ascended_gem_type !== undefined) {
      useCharacterRecordStore.setState({ pickaxeAscendedGemType: result.ascended_gem_type })
    }
  }

  return result
}
