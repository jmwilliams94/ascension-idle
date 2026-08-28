import { useEffect } from 'react'
import { useSessionConflictStore } from '../game/social/useSessionConflictStore'

// Mirrors PetToast.tsx's pattern (nullable-store-driven, setTimeout
// auto-clear). Mounted at App.tsx root rather than inside GameShell, since
// the signOut() this follows unmounts GameShell -- the toast needs to
// outlive that to explain why the player landed back on the login screen.
export default function SessionEvictedToast() {
  const evictedByOther = useSessionConflictStore((state) => state.evictedByOther)
  const dismissEvicted = useSessionConflictStore((state) => state.dismissEvicted)

  useEffect(() => {
    if (!evictedByOther) {
      return undefined
    }

    const timeout = setTimeout(() => dismissEvicted(), 5000)
    return () => clearTimeout(timeout)
  }, [evictedByOther, dismissEvicted])

  if (!evictedByOther) {
    return null
  }

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-1.5 text-center text-xs font-semibold text-amber-300">
        You were signed out because this account was accessed from another session.
      </div>
    </div>
  )
}
