import { useGLTF } from '@react-three/drei'

// Renders a single GLB at the origin. Kept dumb on purpose -- gear-layering
// (multiple Character-like meshes parented under one rig) and animation
// playback are follow-up work once real model files exist; this just proves
// the load path end-to-end. useGLTF suspends internally, so this must always
// render inside a <Suspense> boundary (see GameViewport's <Loader> fallback).
export default function Character({ modelPath }: { modelPath: string }) {
  const { scene } = useGLTF(modelPath)
  return <primitive object={scene} />
}
