import { Html, useProgress } from '@react-three/drei'

// drei's useProgress reads loading-manager progress for whatever's currently
// suspended inside the same <Suspense> boundary (e.g. Character's useGLTF
// call) -- must be rendered inside that boundary's fallback, not beside it.
export default function ModelLoader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div className="whitespace-nowrap rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300">
        Loading model… {Math.round(progress)}%
      </div>
    </Html>
  )
}
