import { create } from 'zustand'

// 3D model rendering (2026-08-20) -- dev/debug slice for the Settings ->
// Rendering test panel (see RenderingTestPanel.tsx). Paths are GLB paths
// under public/models/ (e.g. '/models/characters/base.glb'), not item ids --
// this is deliberately decoupled from the real gameplay equipment system
// (useEquipmentStore.ts's EquipSlot) since it's just a viewer for swapping
// in model files by hand while art gets built out. Slot names mirror
// EquipSlot's naming where they overlap so wiring this up to real gear later
// is a rename, not a redesign.
export type RenderSlot = 'weapon' | 'helmet' | 'armor'

export const RENDER_SLOTS: RenderSlot[] = ['weapon', 'helmet', 'armor']

interface BloomSettings {
  enabled: boolean
  intensity: number
}

interface RenderState {
  characterModelPath: string | null
  equippedItems: Partial<Record<RenderSlot, string>>
  bloom: BloomSettings
  setCharacterModelPath: (path: string | null) => void
  setEquippedItem: (slot: RenderSlot, path: string | null) => void
  setBloomEnabled: (enabled: boolean) => void
  setBloomIntensity: (intensity: number) => void
}

export const useRenderStore = create<RenderState>((set) => ({
  characterModelPath: null,
  equippedItems: {},
  // Off/low by default (per spec) so Bloom doesn't wash out non-glowing
  // models -- intensity only matters once enabled is toggled on.
  bloom: { enabled: false, intensity: 0.4 },
  setCharacterModelPath: (path) => set({ characterModelPath: path }),
  setEquippedItem: (slot, path) =>
    set((state) => {
      const next = { ...state.equippedItems }
      if (path) next[slot] = path
      else delete next[slot]
      return { equippedItems: next }
    }),
  setBloomEnabled: (enabled) => set((state) => ({ bloom: { ...state.bloom, enabled } })),
  setBloomIntensity: (intensity) => set((state) => ({ bloom: { ...state.bloom, intensity } })),
}))
