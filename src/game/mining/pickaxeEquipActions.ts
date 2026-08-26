import { supabase } from '../../lib/supabaseClient'
import { useCharacterRecordStore } from '../../lib/useCharacterRecordStore'

export interface PickaxeEquipResult {
  ok: boolean
  error?: string
  item_id?: string
}

// Pickaxe's own dedicated equip slot (2026-10-24, requested by the user —
// see equippedPickaxe.ts). Takes an explicit item_id (unlike the pre-09-30
// design's bespoke equip_pickaxe, which just grabbed "any owned pickaxe") —
// multiple Pickaxes can be owned/tiered independently, so the player must
// choose which one via drag-and-drop (PickaxeEquipSlot) or the Inventory
// grid's own Equip button (InventoryPanel's handleEquip).
export async function equipPickaxe(characterId: string, itemId: string): Promise<PickaxeEquipResult> {
  const { data, error } = await supabase.rpc('equip_pickaxe', { character_id: characterId, item_id: itemId })

  if (error) {
    console.error('equip_pickaxe call failed', error)
    return { ok: false, error: 'call_failed' }
  }

  const result = data as PickaxeEquipResult
  if (result.ok) {
    useCharacterRecordStore.setState({ equippedPickaxeId: result.item_id ?? itemId })
  }
  return result
}

export async function unequipPickaxe(characterId: string): Promise<PickaxeEquipResult> {
  const { data, error } = await supabase.rpc('unequip_pickaxe', { character_id: characterId })

  if (error) {
    console.error('unequip_pickaxe call failed', error)
    return { ok: false, error: 'call_failed' }
  }

  const result = data as PickaxeEquipResult
  if (result.ok) {
    useCharacterRecordStore.setState({ equippedPickaxeId: null })
  }
  return result
}
