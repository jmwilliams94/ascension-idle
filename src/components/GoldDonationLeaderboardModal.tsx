import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'

interface LeaderboardEntry {
  rank: number
  character_name: string
  total_donated: number
}

interface LeaderboardResult {
  ok: boolean
  entries: LeaderboardEntry[]
  self: { rank: number; total_donated: number } | null
}

const RANK_ACCENT: Record<number, string> = {
  1: 'text-amber-300',
  2: 'text-slate-300',
  3: 'text-orange-400',
}

// Direct adaptation of WorldBossLeaderboardModal.tsx — same fixed-inset
// backdrop shell, same fetch-fresh-every-open-no-cache RPC pattern, just
// total_donated/get_gold_donation_leaderboard/pool_id in place of
// total_damage/get_world_boss_leaderboard/spawn_id.
export default function GoldDonationLeaderboardModal({
  characterId,
  poolId,
  onClose,
}: {
  characterId: string
  poolId: string
  onClose: () => void
}) {
  const [result, setResult] = useState<LeaderboardResult | null>(null)
  const [loading, setLoading] = useState(true)
  useLockBodyScroll()

  useEffect(() => {
    let cancelled = false
    void supabase
      .rpc('get_gold_donation_leaderboard', { p_character_id: characterId, p_pool_id: poolId })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('get_gold_donation_leaderboard call failed', error)
          setResult(null)
        } else {
          setResult(data as LeaderboardResult)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [characterId, poolId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">Gold Donation Leaderboard</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}

        {!loading && (!result || !result.ok) && <p className="py-6 text-center text-sm text-slate-500">Couldn't load the leaderboard.</p>}

        {!loading && result?.ok && (
          <>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {result.entries.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No donations yet.</p>}
              {result.entries.map((entry) => (
                <div
                  key={entry.rank}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs"
                >
                  <span className={`w-8 shrink-0 font-bold ${RANK_ACCENT[entry.rank] ?? 'text-slate-500'}`}>#{entry.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{entry.character_name}</span>
                  <span className="shrink-0 text-slate-400">{entry.total_donated.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {result.self && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
                <span className="font-bold text-amber-300">#{result.self.rank}</span>
                <span className="flex-1 text-amber-100">You</span>
                <span className="text-amber-200">{result.self.total_donated.toLocaleString()}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
