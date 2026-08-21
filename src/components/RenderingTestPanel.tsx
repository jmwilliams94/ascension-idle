import { useState } from 'react'
import GameViewport from './three/GameViewport'
import Character from './three/Character'
import ModelErrorBoundary from './three/ModelErrorBoundary'
import { RENDER_SLOTS, useRenderStore, type RenderSlot } from '../game/rendering/useRenderStore'

const SLOT_LABELS: Record<RenderSlot, string> = {
  weapon: 'Weapon',
  helmet: 'Helmet',
  armor: 'Armor',
}

const inputClass =
  'flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600'

// Rendering (2026-08-20, requested by the user) -- dev/debug tab for testing
// GLB model loading ahead of any real 3D art existing yet. Lives in the
// Settings modal alongside Suggestions/Bug Reports (see SettingsModal.tsx)
// since it's a support/dev page, not gameplay UI. Paths are typed in by hand
// against public/models/ -- no file picker, no asset catalog, this is purely
// for eyeballing whether a given GLB loads and looks right before it's wired
// into real gear/character systems.
export default function RenderingTestPanel() {
  const characterModelPath = useRenderStore((state) => state.characterModelPath)
  const setCharacterModelPath = useRenderStore((state) => state.setCharacterModelPath)
  const equippedItems = useRenderStore((state) => state.equippedItems)
  const setEquippedItem = useRenderStore((state) => state.setEquippedItem)
  const bloom = useRenderStore((state) => state.bloom)
  const setBloomEnabled = useRenderStore((state) => state.setBloomEnabled)
  const setBloomIntensity = useRenderStore((state) => state.setBloomIntensity)
  const emissivePulse = useRenderStore((state) => state.emissivePulse)
  const setEmissivePulse = useRenderStore((state) => state.setEmissivePulse)

  const [characterDraft, setCharacterDraft] = useState(characterModelPath ?? '')
  const [slotDrafts, setSlotDrafts] = useState<Partial<Record<RenderSlot, string>>>({})

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Rendering</h2>
        <p className="text-sm text-slate-400">Load a GLB from public/models/ to preview it here.</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        <div className="h-80 w-full">
          <ModelErrorBoundary resetKey={[characterModelPath, ...RENDER_SLOTS.map((slot) => equippedItems[slot])].join('|')}>
            <GameViewport bloomEnabled={bloom.enabled} bloomIntensity={bloom.intensity}>
              {characterModelPath && <Character modelPath={characterModelPath} emissivePulse={emissivePulse} />}
              {RENDER_SLOTS.map((slot) => {
                const path = equippedItems[slot]
                return path ? <Character key={slot} modelPath={path} emissivePulse={emissivePulse} /> : null
              })}
            </GameViewport>
          </ModelErrorBoundary>
        </div>
        {!characterModelPath && (
          <p className="border-t border-slate-800 bg-slate-950/60 px-3 py-2 text-center text-xs text-slate-500">
            No model loaded — enter a path below.
          </p>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          setCharacterModelPath(characterDraft.trim() || null)
        }}
        className="flex items-center gap-2"
      >
        <p className="w-16 shrink-0 text-xs uppercase tracking-wide text-slate-500">Model</p>
        <input
          type="text"
          value={characterDraft}
          onChange={(event) => setCharacterDraft(event.target.value)}
          placeholder="/models/characters/base.glb"
          className={inputClass}
        />
        <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-amber-500/60 hover:text-slate-100">
          Load
        </button>
      </form>

      <div className="space-y-2">
        {RENDER_SLOTS.map((slot) => (
          <form
            key={slot}
            onSubmit={(event) => {
              event.preventDefault()
              setEquippedItem(slot, (slotDrafts[slot] ?? '').trim() || null)
            }}
            className="flex items-center gap-2"
          >
            <p className="w-16 shrink-0 text-xs uppercase tracking-wide text-slate-500">{SLOT_LABELS[slot]}</p>
            <input
              type="text"
              value={slotDrafts[slot] ?? equippedItems[slot] ?? ''}
              onChange={(event) => setSlotDrafts((prev) => ({ ...prev, [slot]: event.target.value }))}
              placeholder={`/models/gear/${slot}/example.glb`}
              className={inputClass}
            />
            <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-amber-500/60 hover:text-slate-100">
              Equip
            </button>
          </form>
        ))}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <label className="flex items-center justify-between text-sm text-slate-300">
          <span>Bloom</span>
          <input
            type="checkbox"
            checked={bloom.enabled}
            onChange={(event) => setBloomEnabled(event.target.checked)}
          />
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span className="w-16 shrink-0">Intensity</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={bloom.intensity}
            disabled={!bloom.enabled}
            onChange={(event) => setBloomIntensity(Number(event.target.value))}
            className="flex-1 disabled:opacity-40"
          />
          <span className="w-8 shrink-0 text-right">{bloom.intensity.toFixed(1)}</span>
        </label>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <label className="flex items-center justify-between text-sm text-slate-300">
          <span>Emissive Pulse</span>
          <input
            type="checkbox"
            checked={emissivePulse.enabled}
            onChange={(event) => setEmissivePulse({ enabled: event.target.checked })}
          />
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Travels along a model's longest axis, multiplied against its emissiveMap (if it has one) — only lights up
          textures like glowing veins/cracks, not the whole surface.
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span className="w-16 shrink-0">Speed</span>
          <input
            type="range"
            min={0.05}
            max={2}
            step={0.05}
            value={emissivePulse.speed}
            disabled={!emissivePulse.enabled}
            onChange={(event) => setEmissivePulse({ speed: Number(event.target.value) })}
            className="flex-1 disabled:opacity-40"
          />
          <span className="w-8 shrink-0 text-right">{emissivePulse.speed.toFixed(2)}</span>
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span className="w-16 shrink-0">Width</span>
          <input
            type="range"
            min={0.02}
            max={0.6}
            step={0.02}
            value={emissivePulse.width}
            disabled={!emissivePulse.enabled}
            onChange={(event) => setEmissivePulse({ width: Number(event.target.value) })}
            className="flex-1 disabled:opacity-40"
          />
          <span className="w-8 shrink-0 text-right">{emissivePulse.width.toFixed(2)}</span>
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span className="w-16 shrink-0">Intensity</span>
          <input
            type="range"
            min={0.5}
            max={25}
            step={0.5}
            value={emissivePulse.intensity}
            disabled={!emissivePulse.enabled}
            onChange={(event) => setEmissivePulse({ intensity: Number(event.target.value) })}
            className="flex-1 disabled:opacity-40"
          />
          <span className="w-8 shrink-0 text-right">{emissivePulse.intensity.toFixed(1)}</span>
        </label>
      </div>
    </div>
  )
}
