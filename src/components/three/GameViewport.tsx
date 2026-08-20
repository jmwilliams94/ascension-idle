import { Suspense, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, Center, OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import ModelLoader from './ModelLoader'

interface GameViewportProps {
  children?: ReactNode
  className?: string
  // Bloom defaults to off/low (per design) -- a glow effect this strong
  // washes out non-glowing models, so it's opt-in per caller rather than
  // always-on. See useRenderStore's `bloom` slice for the Rendering panel's
  // live-tunable version of these same two props.
  bloomEnabled?: boolean
  bloomIntensity?: number
}

// Generic <Canvas> + lighting + orbit-controls shell -- dev/debug viewport
// for now (per spec), reused by RenderingTestPanel. Not gameplay UI.
export default function GameViewport({
  children,
  className = 'h-full w-full',
  bloomEnabled = false,
  bloomIntensity = 0.4,
}: GameViewportProps) {
  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 1.4, 3.2], fov: 45 }} shadows>
        {/* Matches the app's near-black navy theme (vite.config.ts theme_color) */}
        <color attach="background" args={['#0b0f19']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.2} castShadow />

        <Suspense fallback={<ModelLoader />}>
          {/* Source models arrive at whatever real-world scale they were
              exported at (e.g. Meshy's cm size picker) -- Bounds measures
              whatever's mounted underneath and reframes the camera to fit
              it, and Center recenters it at the origin, so any model/gear
              scale looks right without hardcoding a target size. `observe`
              re-fits if the mounted content changes (e.g. swapping paths). */}
          <Bounds fit clip observe margin={1.2}>
            <Center>{children}</Center>
          </Bounds>
        </Suspense>

        <OrbitControls makeDefault enableDamping />

        {bloomEnabled && (
          <EffectComposer>
            <Bloom intensity={bloomIntensity} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  )
}
