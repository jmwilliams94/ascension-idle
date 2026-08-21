import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export interface EmissivePulseOptions {
  enabled: boolean
  speed: number // cycles per second (hilt -> tip -> repeat)
  width: number // 0-1, fraction of the model's length the glow band covers
  intensity: number // extra multiplier added to totalEmissiveRadiance at the pulse's peak
}

interface PatchedUniforms {
  uPulseT: { value: number }
  uPulseWidth: { value: number }
  uPulseIntensity: { value: number }
}

// Animates a brightness band traveling along a mesh's longest local axis,
// multiplied against its *existing* emissiveMap -- so it only lights up
// whatever the artist/generator already baked into that texture (e.g. a
// blade's glowing veins) rather than the whole surface. Patches
// MeshStandardMaterial (and MeshPhysicalMaterial, which extends it) via
// onBeforeCompile so the model's original PBR textures/lighting are left
// completely alone; materials with no emissiveMap are skipped, so it's safe
// to apply to any Character instance (base body or gear) even if that
// particular model has no glow texture at all.
export function useEmissivePulse(target: THREE.Object3D | null, options: EmissivePulseOptions) {
  const optionsRef = useRef(options)
  // Assigning ref.current directly in the render body trips the
  // react-hooks/refs rule -- syncing it in an effect (no deps, so it runs
  // after every render) is the React-blessed "useLatest" pattern for reading
  // current props/state from an imperative callback (useFrame below) without
  // re-subscribing that callback on every change.
  useEffect(() => {
    optionsRef.current = options
  })

  const patchedRef = useRef<PatchedUniforms[]>([])

  // Re-patch only when the target model or the on/off toggle changes --
  // speed/width/intensity are read fresh from optionsRef in useFrame below,
  // so dragging those sliders updates uniforms live without forcing a shader
  // recompile on every tick.
  useEffect(() => {
    if (!target || !options.enabled) {
      patchedRef.current = []
      return
    }

    const box = new THREE.Box3().setFromObject(target)
    const size = box.getSize(new THREE.Vector3())
    // Assumes the longest local dimension runs hilt-to-tip (or handle-to-head,
    // etc.) -- a reasonable default for bladed/pole weapons, not guaranteed
    // for every gear shape.
    const axisIndex = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2
    const axis = new THREE.Vector3(axisIndex === 0 ? 1 : 0, axisIndex === 1 ? 1 : 0, axisIndex === 2 ? 1 : 0)
    const min = box.min.getComponent(axisIndex)
    const max = box.max.getComponent(axisIndex)

    const patched: PatchedUniforms[] = []

    target.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        if (!material.isMeshStandardMaterial || !material.emissiveMap) continue

        // three.js caches compiled WebGLPrograms by a key derived from the
        // material's own properties -- it does NOT account for what
        // onBeforeCompile actually does. r3f's render loop can compile this
        // material's original (unpatched) program on an early frame before
        // this effect even runs; without a distinct cache key, the renderer
        // then silently reuses that already-compiled program on
        // needsUpdate and never calls onBeforeCompile again, so the patch
        // appears to do nothing. A unique key per patched material forces
        // its own program slot.
        material.customProgramCacheKey = () => `emissive-pulse-${material.uuid}`

        material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
          shader.uniforms.uPulseT = { value: 0 }
          shader.uniforms.uPulseAxis = { value: axis }
          shader.uniforms.uPulseMin = { value: min }
          shader.uniforms.uPulseMax = { value: max }
          // 0 here is a placeholder -- useFrame below overwrites these every
          // frame from the live optionsRef, so this effect deliberately
          // doesn't depend on options.width/options.intensity.
          shader.uniforms.uPulseWidth = { value: 0 }
          shader.uniforms.uPulseIntensity = { value: 0 }

          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uPulseAxis;\nvarying float vPulseCoord;')
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\n\tvPulseCoord = dot( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz, uPulseAxis );',
            )

          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              '#include <common>\nuniform float uPulseT;\nuniform float uPulseMin;\nuniform float uPulseMax;\nuniform float uPulseWidth;\nuniform float uPulseIntensity;\nvarying float vPulseCoord;',
            )
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
	float pulseCoord = clamp( ( vPulseCoord - uPulseMin ) / max( uPulseMax - uPulseMin, 0.0001 ), 0.0, 1.0 );
	float pulseDist = abs( pulseCoord - uPulseT );
	float pulseGlow = 1.0 - smoothstep( 0.0, uPulseWidth, pulseDist );
	totalEmissiveRadiance *= ( 1.0 + pulseGlow * uPulseIntensity );`,
            )

          patched.push(shader.uniforms as unknown as PatchedUniforms)
        }
        material.needsUpdate = true
      }
    })

    patchedRef.current = patched
  }, [target, options.enabled])

  useFrame((state) => {
    if (!optionsRef.current.enabled) return
    const { speed, width, intensity } = optionsRef.current
    const t = (state.clock.elapsedTime * speed) % 1
    /* eslint-disable react-hooks/immutability -- intentional r3f pattern:
       mutating a three.js uniform's .value every frame outside React's
       render cycle is how useFrame is meant to be used (the alternative,
       driving this via React state at 60fps, is the actual anti-pattern).
       The react-hooks/immutability rule has no carve-out for this
       ecosystem-standard imperative escape hatch. */
    for (const uniforms of patchedRef.current) {
      uniforms.uPulseT.value = t
      uniforms.uPulseWidth.value = width
      uniforms.uPulseIntensity.value = intensity
    }
    /* eslint-enable react-hooks/immutability */
  })
}
