import { useState } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Object3D } from 'three'
import { useEmissivePulse, type EmissivePulseOptions } from './useEmissivePulse'

interface CharacterProps {
  modelPath: string
  // Optional -- see useEmissivePulse.ts. Safe to pass on any model; meshes
  // without an emissiveMap are skipped automatically.
  emissivePulse?: EmissivePulseOptions
}

// Renders a single GLB at the origin. Kept dumb on purpose -- gear-layering
// (multiple Character-like meshes parented under one rig) and animation
// playback are follow-up work once real model files exist; this just proves
// the load path end-to-end. useGLTF suspends internally, so this must always
// render inside a <Suspense> boundary (see GameViewport's <Loader> fallback).
export default function Character({ modelPath, emissivePulse }: CharacterProps) {
  const { scene } = useGLTF(modelPath)
  // A plain useRef's .current wouldn't trigger a re-render once set, so
  // useEmissivePulse below would only ever see null -- state set via the ref
  // callback re-renders once the object3D actually exists after mount.
  const [node, setNode] = useState<Object3D | null>(null)
  useEmissivePulse(node, emissivePulse ?? { enabled: false, speed: 0.4, width: 0.18, intensity: 2 })
  return <primitive ref={setNode} object={scene} />
}
