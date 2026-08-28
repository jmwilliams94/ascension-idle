import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'

interface LeaderboardEntry {
  rank: number
  character_name: string
  total_damage: number
}

interface LeaderboardResult {
  ok: boolean
  entries: LeaderboardEntry[]
  self: { rank: number; total_damage: number } | null
}

const RANK_ACCENT: Record<number, string> = {
  1: 'text-amber-300',
  2: 'text-slate-300',
  3: 'text-orange-400',
}

// Same fixed-inset backdrop shell as MarketplacePanel.tsx's MailDetailModal.
export default function WorldBossLeaderboardModal({
  characterId,
  spawnId,
  onClose,
}: {
  characterId: string
  spawnId: string
  onClose: () => void
}) {
  const [result, setResult] = useState<LeaderboardResult | null>(null)
  useLockBodyScroll()
  // Starts true (the very first render, before the effect below has had a
  // chance to run) — not reset to true again on a later spawnId change, so a
  // refetch just quietly replaces stale data instead of flashing a spinner.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // Fetched fresh every open, no cache — a cheap single indexed query,
    // same reasoning view_character_loadout's own RPC call uses.
    void supabase
      .rpc('get_world_boss_leaderboard', { p_character_id: characterId, p_spawn_id: spawnId })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('get_world_boss_leaderboard call failed', error)
          setResult(null)
        } else {
          setResult(data as LeaderboardResult)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [characterId, spawnId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">World Boss Leaderboard</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}

        {!loading && (!result || !result.ok) && <p className="py-6 text-center text-sm text-slate-500">Couldn't load the leaderboard.</p>}

        {!loading && result?.ok && (
          <>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {result.entries.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No attempts yet.</p>}
              {result.entries.map((entry) => (
                <div key={entry.rank} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs">
                  <span className={`w-8 shrink-0 font-bold ${RANK_ACCENT[entry.rank] ?? 'text-slate-500'}`}>#{entry.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{entry.character_name}</span>
                  <span className="shrink-0 text-slate-400">{entry.total_damage.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {result.self && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
                <span className="font-bold text-amber-300">#{result.self.rank}</span>
                <span className="flex-1 text-amber-100">You</span>
                <span className="text-amber-200">{result.self.total_damage.toLocaleString()}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
