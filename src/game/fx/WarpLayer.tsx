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
//
// fadeAlpha ramps this whole plane in over the first 8% of progress and back
// out over the last 30% -- without it, the plane pops in at full opacity the
// instant the WebGL context has anything to show (a visible dark flash, since
// the default GL clear color is opaque black before the first real frame)
// and then hard-cuts back to the live page the instant progress hits 1 and
// WarpLayer unmounts, which read as a jarring "flick" (reported by the
// user) -- made worse because the ring has already traveled off-screen well
// before progress=1, so for a stretch beforehand the plane is just showing
// the captured "photo" undistorted, and that photo is a slightly degraded
// stand-in for the live page (see screenCapture.ts's skipFonts/image-skip
// comments) -- fading it out cross-fades into the correct live page instead
// of holding on the flawed one and then cutting.
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

    float fadeIn = smoothstep(0.0, 0.08, uProgress);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, uProgress);
    float fadeAlpha = fadeIn * fadeOut;

    gl_FragColor = vec4(r, g, b, fadeAlpha);
  }
`

function WarpMesh({ warp }: { warp: ActiveWarp }) {
  const { size } = useThree()
  const clear = useWarpStore((state) => state.clear)

  const texture = useMemo(() => {
    const tex = new THREE.CanvasTexture(warp.canvas)
    // Deliberately NOT tex.colorSpace = THREE.SRGBColorSpace -- that tag
    // makes Three.js decode the texture's stored bytes as sRGB on every
    // texture2D() sample (sRGB -> linear), but this shader just passes the
    // sampled r/g/b straight through to gl_FragColor with no corresponding
    // re-encode back to sRGB (there's no lighting/PBR math here needing
    // linear space at all) -- so tagging it SRGBColorSpace silently
    // darkened every warp by one full sRGB decode pass (confirmed via a
    // known-color test: source #1b2436 rendered as ~#03040a, which is
    // exactly the sRGB-decoded value of the source, to the pixel). Leaving
    // colorSpace at its default (NoColorSpace) samples the raw bytes
    // untouched, matching what the browser already displayed when this was
    // captured.
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
        transparent
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
// full-screen "photo" of the page at the moment a warp is triggered (see
// useWarpStore.ts/screenCapture.ts), distorts that photo (fading in/out at
// the edges, see FRAGMENT_SHADER's fadeAlpha), then hides to reveal the
// real live page again -- it never touches the actual DOM pixels
// underneath, which is what keeps this technique clear of the
// backdrop-filter + position:fixed iOS Safari bug that bit this game's
// toasts/HUD repeatedly (see the backdrop-blur gotcha memory): there's no
// backdrop-filter here at all, just an ordinary WebGL canvas.
//
// The <Canvas> itself stays mounted permanently (never unmounted/remounted
// per trigger) -- only `frameloop` toggles between 'never' (idle: no
// rendering at all, effectively zero per-frame cost) and 'always' (a warp is
// live). An earlier version mounted/unmounted the whole <Canvas> per
// trigger, which meant creating a brand new WebGL context and recompiling
// the shader every single time -- a real, mobile-disproportionate cost
// (weaker GPUs/drivers handle context creation far worse than desktop) that
// was still making the effect feel choppy even after the render-loop and
// capture-cost fixes; reported by the user specifically on mobile. Keeping
// one warm context and just pausing/resuming its render loop avoids paying
// that setup cost on every trigger while still not burning cycles while
// idle. z-[45], between the real game UI and FxLayer's own 2D canvas
// (z-[47]) -- comet/lightning's glow keeps drawing on top of the warped
// snapshot underneath it, layering "real distortion" with "extra light VFX"
// the way game hit-effects usually do. Both sit below the app's z-50 modal
// scale (BankActionModal, SettingsModal, etc.) so an in-flight lightning
// bolt or warp doesn't render on top of an open menu/popup -- they used to
// sit at z-[88]/z-[90], above every modal in the app, letting attack VFX
// bleed over whatever overlay the player had open (reported by the user).
export default function WarpLayer() {
  const active = useWarpStore((state) => state.active)

  return createPortal(
    <Canvas
      data-fx-exclude="true"
      className="z-[45]"
      // Canvas applies its own inline `position: relative; width/height:
      // 100%; pointer-events: auto` to this wrapper div by default -- an
      // inline style always beats a class-based utility in the cascade
      // regardless of specificity, so `fixed inset-0 pointer-events-none` in
      // className would silently lose to it (confirmed via
      // getComputedStyle while building this: position read back as
      // "relative" with a content-driven 150px fallback height instead of
      // the viewport, and separately -- once this became a permanently-
      // mounted element in v1.118.7, not just a ~900ms one -- pointer-events
      // read back as "auto" everywhere down to the actual <canvas>,
      // silently swallowing every click on the page the whole time the game
      // was open, including the What's New modal's "Got it" button;
      // Playwright's own click-retry log named the culprit directly: "…
      // subtree intercepts pointer events"). Passing position/inset/
      // pointerEvents here explicitly is what actually wins over Canvas's
      // own defaults.
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
      orthographic
      dpr={1}
      // alpha: true + a zero-alpha clear color (below) means whenever the
      // canvas isn't actively showing a warp (including the very first
      // frame right after this permanent context is created), it shows the
      // real live page through it instead of an opaque black flash -- the
      // default GL clear is opaque black regardless of the context's own
      // alpha support, so alpha: true alone isn't enough, the renderer's
      // clear color has to be told explicitly too.
      gl={{ alpha: true, antialias: false, toneMapping: THREE.NoToneMapping }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      frameloop={active ? 'always' : 'never'}
    >
      {active && <WarpMesh key={active.id} warp={active} />}
    </Canvas>,
    document.body,
  )
}
