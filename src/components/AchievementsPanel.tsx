import { useState } from 'react'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId } from '../game/zones/zoneData'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import {
  ACHIEVEMENT_GOLD_MULTIPLIER,
  ACHIEVEMENT_TIER2_COST,
  FREE_ACHIEVEMENT_TIERS,
  PET_DROP_CHANCE,
  currentAchievementTier,
  nextAchievementTier,
} from '../game/achievements/achievementData'

// Achievements & Pets, Stage 1 (confirmed shape, see CLAUDE.md — added from a
// mobile session). Grouped by zone (reusing ZONE_ORDER/ZONES the same way
// CombatPage's picker does) since a flat 40-row list would be unwieldy.
// Per monster: two kill-count ladders (character/account) with a progress bar
// toward the next tier, the currently-active PLACEHOLDER gold multiplier
// (character ladder only — the account-wide ladder's own reward category is
// explicitly undecided per the user, so it only ever shows progress here,
// never an effect), a "Unlock tier 2" button once eligible, and a Pet
// obtained/locked indicator. The account ladder shows a disabled "Coming
// soon" row once past 500 kills — matches this game's existing convention
// for not-yet-built content (locked classes, locked zones) rather than
// hiding it.
function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 100
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

function MonsterRow({ characterId, monsterId, displayName }: { characterId: string; monsterId: EnemyTypeId; displayName: string }) {
  const characterEntry = useAchievementsStore((state) => state.characterKills[monsterId])
  const accountKills = useAchievementsStore((state) => state.accountKills[monsterId] ?? 0)
  const hasPet = useAchievementsStore((state) => state.pets.has(monsterId))
  const busy = useAchievementsStore((state) => state.busy)
  const unlockTier2 = useAchievementsStore((state) => state.unlockTier2)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)

  const [error, setError] = useState<string | null>(null)

  const characterKills = characterEntry?.kills ?? 0
  const tier2Unlocked = characterEntry?.tier2Unlocked ?? false

  const characterTier = currentAchievementTier(characterKills, tier2Unlocked)
  const characterNextTier = nextAchievementTier(characterKills, tier2Unlocked)
  const characterMultiplier = characterTier ? ACHIEVEMENT_GOLD_MULTIPLIER[characterTier] : 1

  const accountNextTier = nextAchievementTier(accountKills, false)
  const accountMaxedFree = accountKills >= FREE_ACHIEVEMENT_TIERS[FREE_ACHIEVEMENT_TIERS.length - 1]

  const handleUnlockTier2 = async () => {
    setError(null)
    const result = await unlockTier2(characterId, monsterId)
    if (!result.ok) {
      setError(
        result.error === 'not_enough_dragonballs'
          ? "You don't have enough DragonBalls."
          : result.error === 'already_unlocked'
            ? 'Already unlocked.'
            : 'Something went wrong.',
      )
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-200">{displayName}</p>
        <div className="flex items-center gap-2 text-xs">
          <span className={hasPet ? 'text-amber-300' : 'text-slate-600'}>{hasPet ? '🐾 Pet obtained' : '🔒 Pet locked'}</span>
        </div>
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Character: {characterKills.toLocaleString()}</span>
            <span>{characterNextTier ? `Next: ${characterNextTier.toLocaleString()}` : 'Maxed'}</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={characterKills} max={characterNextTier ?? characterKills} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Reward: <span className="text-emerald-400">{characterTier ? `+${Math.round((characterMultiplier - 1) * 100)}% gold` : '—'}</span>
          </p>

          {!tier2Unlocked && (
            <button
              type="button"
              disabled={busy || dragonballs < ACHIEVEMENT_TIER2_COST}
              onClick={() => void handleUnlockTier2()}
              title={dragonballs < ACHIEVEMENT_TIER2_COST ? `Need ${ACHIEVEMENT_TIER2_COST} DragonBalls` : undefined}
              className="mt-1.5 rounded-lg border border-purple-600 bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Unlock tier 2 ({ACHIEVEMENT_TIER2_COST} DragonBalls)
            </button>
          )}
          {error && <p className="mt-1 text-[11px] text-amber-400">{error}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Account: {accountKills.toLocaleString()}</span>
            <span>{accountMaxedFree ? 'Coming soon' : accountNextTier ? `Next: ${accountNextTier.toLocaleString()}` : ''}</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={accountKills} max={accountNextTier ?? accountKills} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Reward: not designed yet</p>
        </div>
      </div>
    </div>
  )
}

export default function AchievementsPanel({ characterId }: { characterId: string }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Kill a monster repeatedly to climb its two ladders — your own kills, and every character on this account combined. Reaching a
        tier grants a bonus while fighting that monster (placeholder values for now). Every monster also has a 1 in{' '}
        {(1 / PET_DROP_CHANCE).toLocaleString()} chance per kill to drop its pet — account-wide, one per monster, forever.
      </p>

      {ZONE_ORDER.map((zoneId) => {
        const zone = ZONES[zoneId]
        if (zone.monsterOrder.length === 0) {
          return null
        }

        return (
          <div key={zoneId} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <p className="text-sm font-medium text-slate-200">{zone.displayName}</p>
            <div className="mt-2 space-y-2">
              {zone.monsterOrder.map((monsterId) => (
                <MonsterRow key={monsterId} characterId={characterId} monsterId={monsterId} displayName={ENEMY_TYPES[monsterId].displayName} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
