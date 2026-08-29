import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useWarpStore, type ActiveWarp } from './useWarpStore'

const DURATION_MS = 900

// Full-screen quad in clip space -- deliberately ignores the camera's
// projection/view matrices entirely (gl_Position is set directly from raw
// position, not multiplied through modelViewMatrix/projectionMatrix) so the
// plane always exactly fills the viewport regardless of camera setup. The
// standard trick for a full-screen shader pass.
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Radial shockwave: a Gaussian-shaped displacement ring expands outward
// from uCenter and fades as uProgress goes 0 -> 1, pushing sampled UVs
// outward along the ring (a real distortion of the captured screen texture,
// not a shape drawn on top of it) plus a small per-channel offset for a
// glassy chromatic-aberration edge on the ring itself.
const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform vec2 uCenter;
  uniform float uProgress;
  varying vec2 vUv;

  void main() {
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 diff = (vUv - uCenter) * aspect;
    float dist = length(diff);
    vec2 dir = dist > 0.0001 ? diff / dist : vec2(0.0);

    float ringRadius = uProgress * 0.9;
    float ringWidth = 0.12;
    float wave = exp(-pow((dist - ringRadius) / ringWidth, 2.0));
    float envelope = 1.0 - uProgress;
    float strength = wave * envelope * 0.06;

    vec2 offset = (dir / aspect) * strength;
    float r = texture2D(uTexture, vUv + offset * 1.15).r;
    float g = texture2D(uTexture, vUv + offset).g;
    float b = texture2D(uTexture, vUv + offset * 0.85).b;

    gl_FragColor = vec4(r, g, b, 1.0);
  }
`

function WarpMesh({ warp }: { warp: ActiveWarp }) {
  const { size } = useThree()
  const clear = useWarpStore((state) => state.clear)

  const texture = useMemo(() => {
    const tex = new THREE.CanvasTexture(warp.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    // The plane always shows this at native 1:1 scale (full-screen quad,
    // captured canvas ~= viewport size) -- mipmaps only pay off when a
    // texture is minified, so generating a full chain here is pure wasted
    // GPU work on every single trigger.
    tex.generateMipmaps = false
    return tex
  }, [warp.canvas])

  useEffect(() => () => texture.dispose(), [texture])

  // Built once via useMemo purely as the material's *initial* uniforms --
  // never mutated through this identifier afterward. uProgress is instead
  // updated every frame through materialRef.current.uniforms (below), a
  // separate path through the live THREE.ShaderMaterial instance rather
  // than this React-tracked value, since react-hooks' immutability rule
  // forbids mutating a useMemo result and its refs rule forbids reading
  // ref.current during render (only inside effects/callbacks, which
  // useFrame's callback -- running in r3f's own render loop, not React's --
  // counts as). This is r3f's standard way to drive per-frame uniforms
  // without fighting either rule.
  const uniforms = useMemo(
    () => ({
      uTexture: { value: texture },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      // Y flipped -- CanvasTexture's default flipY means v=1 is the top row
      // of the source canvas, while warp.y is a normal top-down screen
      // coordinate.
      uCenter: { value: new THREE.Vector2(warp.x / size.width, 1 - warp.y / size.height) },
      uProgress: { value: 0 },
    }),
    [texture, size, warp],
  )

  const materialRef = useRef<THREE.ShaderMaterial>(null)

  useFrame(() => {
    const material = materialRef.current
    if (!material) {
      return
    }
    const progress = Math.min(1, (performance.now() - warp.startedAt) / DURATION_MS)
    material.uniforms.uProgress.value = progress
    if (progress >= 1) {
      clear(warp.id)
    }
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

// WebGL counterpart to FxLayer.tsx's 2D canvas -- the only way to actually
// distort the real on-screen UI (a true "force wave" push through the
// screen), rather than draw glow/particles on top of it. Presents as a
// full-screen opaque "photo" of the page at the moment a warp is triggered
// (see useWarpStore.ts/screenCapture.ts), distorts that photo, then
// unmounts to reveal the real live page again -- it never touches the
// actual DOM pixels underneath, which is what keeps this technique clear of
// the backdrop-filter + position:fixed iOS Safari bug that bit this game's
// toasts/HUD repeatedly (see the backdrop-blur gotcha memory): there's no
// backdrop-filter here at all, just an ordinary opaque WebGL canvas.
//
// Only mounts a <Canvas> (and therefore only runs a WebGL render loop)
// while a warp is actually active -- an idle background render loop for an
// idle/AFK-heavy game would be a real battery/perf cost for a feature
// nobody's looking at most of the time. z-[88], between the real game UI
// and FxLayer's own 2D canvas (z-[90]) -- comet/lightning's glow keeps
// drawing on top of the warped snapshot underneath it, layering "real
// distortion" with "extra light VFX" the way game hit-effects usually do.
export default function WarpLayer() {
  const active = useWarpStore((state) => state.active)

  if (!active) {
    return null
  }

  return createPortal(
    <Canvas
      data-fx-exclude="true"
      className="pointer-events-none z-[88]"
      // Canvas applies its own inline `position: relative; width/height:
      // 100%` to this wrapper div by default -- an inline style always beats
      // a class-based utility in the cascade regardless of specificity, so
      // `fixed inset-0` in className above silently loses to it (confirmed
      // via getComputedStyle while building this: position read back as
      // "relative", and the canvas sized itself to a content-driven 150px
      // fallback height instead of the viewport). Passing position/inset
      // here explicitly is what actually wins.
      style={{ position: 'fixed', inset: 0 }}
      orthographic
      dpr={1}
      gl={{ alpha: false, antialias: false, toneMapping: THREE.NoToneMapping }}
    >
      <WarpMesh key={active.id} warp={active} />
    </Canvas>,
    document.body,
  )
}
