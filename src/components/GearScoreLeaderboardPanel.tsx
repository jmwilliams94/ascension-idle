import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { AscensionCard } from './ui/AscensionCard'
import { CLASS_DEFINITIONS, CLASS_ORDER, type ClassId } from '../game/stats/classes'
import { useCharacterLoadoutStore } from '../game/social/useCharacterLoadoutStore'

interface LeaderboardEntry {
  rank: number
  character_name: string
  class: string | null
  level: number
  gear_score: number
}

interface LeaderboardResult {
  ok: boolean
  entries: LeaderboardEntry[]
  self: { rank: number; gear_score: number } | null
}

const RANK_ACCENT: Record<number, string> = {
  1: 'text-amber-300',
  2: 'text-slate-300',
  3: 'text-orange-400',
}

// Gear Score Leaderboard (requested by the user) — ranks every character by
// get_gear_score_leaderboard's SQL formula (see equipmentBonus.ts's
// computeItemGearScore for the client-side mirror), filterable by class.
// Clicking a row reuses the existing "inspect another player's gear" flow
// (useCharacterLoadoutStore/CharacterLoadoutModal, see CLAUDE.global-activity.md)
// rather than building a second gear-viewing UI.
export default function GearScoreLeaderboardPanel({ characterId }: { characterId: string }) {
  const [classFilter, setClassFilter] = useState<ClassId | null>(null)
  const [result, setResult] = useState<LeaderboardResult | null>(null)
  const [loading, setLoading] = useState(true)
  const viewCharacter = useCharacterLoadoutStore((state) => state.viewCharacter)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void supabase
      .rpc('get_gear_score_leaderboard', { p_character_id: characterId, p_class: classFilter, p_limit: 50 })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('get_gear_score_leaderboard call failed', error)
          setResult(null)
        } else {
          setResult(data as LeaderboardResult)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [characterId, classFilter])

  return (
    <div className="space-y-3">
      <AscensionCard contentClassName="p-3">
        <p className="text-xs text-slate-300">
          Ranked by Gear Score — quality tier, sockets, composition, Enchant HP tier, and Bless tier across your equipped gear.
        </p>
      </AscensionCard>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setClassFilter(null)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
            classFilter === null ? 'border-slate-300 bg-slate-300/10 text-slate-100' : 'border-slate-700 text-slate-300 hover:border-slate-400/50'
          }`}
        >
          All
        </button>
        {CLASS_ORDER.map((classId) => (
          <button
            key={classId}
            type="button"
            onClick={() => setClassFilter(classId)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              classFilter === classId
                ? 'border-slate-300 bg-slate-300/10 text-slate-100'
                : 'border-slate-700 text-slate-300 hover:border-slate-400/50'
            }`}
          >
            {CLASS_DEFINITIONS[classId].displayName}
          </button>
        ))}
      </div>

      <AscensionCard contentClassName="p-3">
        {loading && <p className="py-6 text-center text-sm text-slate-300">Loading…</p>}

        {!loading && (!result || !result.ok) && <p className="py-6 text-center text-sm text-slate-300">Couldn't load the leaderboard.</p>}

        {!loading && result?.ok && (
          <>
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {result.entries.length === 0 && <p className="py-6 text-center text-sm text-slate-300">No characters yet.</p>}
              {result.entries.map((entry) => (
                <button
                  key={entry.rank}
                  type="button"
                  onClick={() => viewCharacter(entry.character_name)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs hover:border-amber-500/50"
                >
                  <span className={`w-8 shrink-0 font-bold ${RANK_ACCENT[entry.rank] ?? 'text-slate-300'}`}>#{entry.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-left text-slate-200">{entry.character_name}</span>
                  <span className="shrink-0 text-slate-300">
                    {entry.class ? CLASS_DEFINITIONS[entry.class as ClassId]?.displayName ?? entry.class : '—'} · Lv {entry.level}
                  </span>
                  <span className="shrink-0 font-semibold text-amber-300">{entry.gear_score}</span>
                </button>
              ))}
            </div>

            {result.self && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
                <span className="font-bold text-amber-300">#{result.self.rank}</span>
                <span className="flex-1 text-amber-100">You</span>
                <span className="text-amber-200">{result.self.gear_score}</span>
              </div>
            )}
          </>
        )}
      </AscensionCard>
    </div>
  )
}
