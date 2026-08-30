import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { KernelSize } from 'postprocessing'
import { EVENT_EMBER_HEX } from '../../game/hud/eventEmberBorderData'
import type { EventEmberColor } from '../../game/hud/useEventEmberColor'
import { PLANE_VERTEX, FRAG_PLASMA, FRAG_AURORA, FRAG_FRESNEL, FRAG_PULSE, FRAG_CHROMA, POINT_VERTEX, POINT_FRAGMENT } from './emberShaderData'

// 6 WebGL/shader-based alternatives to EventEmberBorder's CSS particle ring
// (2026-08-30, requested after the plain-CSS gallery in EmberCandidateGallery
// read as flat/unpolished) -- reuses the same three.js/@react-three/fiber/
// @react-three/postprocessing stack RenderingTestPanel/GameViewport.tsx
// already use for the GLB model viewer, so no new dependency was added.
// Lazy-loaded from FxTestPanel.tsx for the same reason RenderingTestPanel
// and FxTestPanel are themselves lazy from SettingsModal.tsx -- see that
// file's header comment on the 2MB Workbox precache limit; the goal is that
// visiting Settings > FX doesn't force every player to download three.js.
// Preview only -- not wired into any real nav button yet.

const TILE_SIZE = 96

const COLOR_OPTIONS: { color: EventEmberColor; label: string }[] = [
  { color: 'collecting', label: 'Gold (collecting)' },
  { color: 'boss', label: 'Red (boss)' },
  { color: 'buffActive', label: 'Green (buff active)' },
  { color: 'luckyFree', label: 'Amber (lucky free)' },
]

// Fills the camera's visible area at z=0 with a 1x1 plane scaled up via
// `viewport` (from useThree) -- the standard R3F "fullscreen quad" idiom,
// robust to camera type/fov/canvas size without hand-tuned frustum math.
function FullscreenPlane({ fragmentShader, color }: { fragmentShader: string; color: string }) {
  const viewport = useThree((state) => state.viewport)
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally created once; color updates below mutate the existing THREE.Color in place
    [],
  )

  useEffect(() => {
    uniforms.uColor.value.set(color)
  }, [color, uniforms])

  useFrame((_, delta) => {
    uniforms.uTime.value += delta
  })

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        toneMapped={false}
        uniforms={uniforms}
        vertexShader={PLANE_VERTEX}
        fragmentShader={fragmentShader}
      />
    </mesh>
  )
}

// Real GPU point sprites orbiting the border with additive blending -- the
// "true WebGL" counterpart to the CSS gallery's single-span Comet Orbit Dot.
function ParticleHalo({ color }: { color: string }) {
  const groupRef = useRef<THREE.Group>(null!)
  const viewport = useThree((state) => state.viewport)
  const count = 36
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      arr[i * 3] = Math.cos(angle) * 0.85
      arr[i * 3 + 1] = Math.sin(angle) * 0.85
      arr[i * 3 + 2] = 0
    }
    return arr
  }, [])
  const sizes = useMemo(() => {
    const arr = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      arr[i] = 0.08 + Math.random() * 0.1
    }
    return arr
  }, [])
  const uniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(color) } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    uniforms.uColor.value.set(color)
  }, [color, uniforms])
  useFrame((_, delta) => {
    groupRef.current.rotation.z += delta * 0.5
  })

  return (
    <group ref={groupRef} scale={[viewport.width / 2, viewport.height / 2, 1]}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        </bufferGeometry>
        <shaderMaterial
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          uniforms={uniforms}
          vertexShader={POINT_VERTEX}
          fragmentShader={POINT_FRAGMENT}
        />
      </points>
    </group>
  )
}

// mipmapBlur's blur radius is tuned for full-screen scenes -- on a 96px
// tile it blows the whole thing into a solid blob (reported 2026-08-30
// after the first pass shipped washed-out/oversaturated). A small fixed
// kernel + a high luminance threshold keeps bloom to a thin glow along the
// already-bright band instead of amplifying the entire semi-transparent
// canvas. R3F's Canvas also defaults gl.toneMapping to ACESFilmicToneMapping,
// which can hue-shift saturated over-1.0 colors (our uColor multipliers
// intentionally exceed 1.0 so Bloom's threshold catches them) toward
// cyan/white -- disabled below via both the Canvas gl prop and each
// material's toneMapped=false, since either alone should suffice but this
// is unverified without a real device/browser to check against.
function BloomLayer({ enabled, intensity }: { enabled: boolean; intensity: number }) {
  if (!enabled) {
    return null
  }
  return (
    <EffectComposer>
      <Bloom intensity={intensity} luminanceThreshold={0.75} luminanceSmoothing={0.2} mipmapBlur={false} kernelSize={KernelSize.SMALL} />
    </EffectComposer>
  )
}

function ShaderTile({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-2xl"
      style={{ width: TILE_SIZE, height: TILE_SIZE }}
    >
      ⛏️
      <div className="pointer-events-none absolute inset-0">
        <Canvas
          gl={{ alpha: true, antialias: true, toneMapping: THREE.NoToneMapping }}
          dpr={[1, 2]}
          camera={{ position: [0, 0, 5], fov: 50 }}
        >
          {children}
        </Canvas>
      </div>
    </div>
  )
}

function Candidate({ id, label, caption, children }: { id: string; label: string; caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{id}</span>
      {children}
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{caption}</p>
      </div>
    </div>
  )
}

export default function WebglEmberGallery() {
  const [color, setColor] = useState<EventEmberColor>('collecting')
  const [bloomEnabled, setBloomEnabled] = useState(false)
  const [bloomIntensity, setBloomIntensity] = useState(0.6)
  const hex = EVENT_EMBER_HEX[color]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">WebGL Shader Candidates</h2>
        <p className="text-sm text-slate-400">
          Real GPU fragment shaders (three.js / @react-three/fiber -- the same stack as Settings &gt; Rendering's GLB
          viewer) with optional bloom postprocessing, aiming for real light/depth instead of the CSS gallery's flat
          box-shadows.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.color}
              type="button"
              onClick={() => setColor(opt.color)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                color === opt.color
                  ? 'border-white/60 bg-white/10 text-white'
                  : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={bloomEnabled} onChange={(event) => setBloomEnabled(event.target.checked)} />
          Bloom
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <span>Intensity</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={bloomIntensity}
            disabled={!bloomEnabled}
            onChange={(event) => setBloomIntensity(Number(event.target.value))}
            className="w-24 disabled:opacity-40"
          />
          <span className="w-8 text-right">{bloomIntensity.toFixed(1)}</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Candidate id="1" label="Plasma Energy Border" caption="Flowing GPU noise circulating around the border">
          <ShaderTile>
            <FullscreenPlane fragmentShader={FRAG_PLASMA} color={hex} />
            <BloomLayer enabled={bloomEnabled} intensity={bloomIntensity} />
          </ShaderTile>
        </Candidate>

        <Candidate id="2" label="Aurora Sweep" caption="Soft color bands flowing through the border ring">
          <ShaderTile>
            <FullscreenPlane fragmentShader={FRAG_AURORA} color={hex} />
            <BloomLayer enabled={bloomEnabled} intensity={bloomIntensity} />
          </ShaderTile>
        </Candidate>

        <Candidate id="3" label="Fresnel Glass Rim" caption="Rim-lit glass edge, brighter at the border, breathing">
          <ShaderTile>
            <FullscreenPlane fragmentShader={FRAG_FRESNEL} color={hex} />
            <BloomLayer enabled={bloomEnabled} intensity={bloomIntensity} />
          </ShaderTile>
        </Candidate>

        <Candidate id="4" label="Radial Pulse Wave" caption="Concentric rings emanating outward and fading">
          <ShaderTile>
            <FullscreenPlane fragmentShader={FRAG_PULSE} color={hex} />
            <BloomLayer enabled={bloomEnabled} intensity={bloomIntensity} />
          </ShaderTile>
        </Candidate>

        <Candidate id="5" label="Chromatic Rim" caption="RGB-split edge shimmer, sci-fi console styling">
          <ShaderTile>
            <FullscreenPlane fragmentShader={FRAG_CHROMA} color={hex} />
            <BloomLayer enabled={bloomEnabled} intensity={bloomIntensity} />
          </ShaderTile>
        </Candidate>

        <Candidate id="6" label="Particle Halo" caption="Real GPU point sprites orbiting with additive glow">
          <ShaderTile>
            <ParticleHalo color={hex} />
            <BloomLayer enabled={bloomEnabled} intensity={bloomIntensity} />
          </ShaderTile>
        </Candidate>
      </div>
    </div>
  )
}
