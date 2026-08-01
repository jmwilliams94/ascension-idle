import { useState } from 'react'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId } from '../game/zones/zoneData'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import {
  ACHIEVEMENT_GOLD_MULTIPLIER,
  PET_DROP_CHANCE,
  currentAchievementTier,
  nextAchievementTier,
  nextTierToUnlock,
} from '../game/achievements/achievementData'

// Achievements & Pets, Stage 1 (confirmed shape, see CLAUDE.md — added from a
// mobile session). Grouped by zone (reusing ZONE_ORDER/ZONES the same way
// CombatPage's picker does) since a flat 40-row list would be unwieldy.
// A "Character"/"Account" tab switcher up top (confirmed with the user,
// 2026-08-01) picks which of the two ladders each monster row shows, rather
// than cramming both side by side — local sub-tab state, not useTabStore,
// same pattern ShopPanel's own Weapons/Armor/Potions sub-tabs already use.
// The account ladder never shows a reward/unlock button at all — its own
// reward category (and any paid tier-2 upgrade for it) is still explicitly
// undecided per the user, so this stage only ever displays its progress.
type Ladder = 'character' | 'account'

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 100
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

function CharacterLadderRow({ characterId, monsterId }: { characterId: string; monsterId: EnemyTypeId }) {
  const characterEntry = useAchievementsStore((state) => state.characterKills[monsterId])
  const busy = useAchievementsStore((state) => state.busy)
  const unlockNextTier = useAchievementsStore((state) => state.unlockNextTier)
  const meteors = useCurrencyStore((state) => state.meteors)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)

  const [error, setError] = useState<string | null>(null)

  const kills = characterEntry?.kills ?? 0
  const unlockedTierIndex = characterEntry?.unlockedTierIndex ?? 0

  const tier = currentAchievementTier(kills, unlockedTierIndex)
  const nextTier = nextAchievementTier(kills, unlockedTierIndex)
  const multiplier = tier ? ACHIEVEMENT_GOLD_MULTIPLIER[tier] : 1
  const toUnlock = nextTierToUnlock(unlockedTierIndex)
  const affordable = toUnlock ? (toUnlock.cost.currency === 'meteor' ? meteors : dragonballs) >= toUnlock.cost.amount : false

  const handleUnlock = async () => {
    setError(null)
    const result = await unlockNextTier(characterId, monsterId)
    if (!result.ok) {
      setError(
        result.error === 'not_enough_meteors'
          ? "You don't have enough Meteors."
          : result.error === 'not_enough_dragonballs'
            ? "You don't have enough DragonBalls."
            : result.error === 'already_maxed'
              ? 'All tiers already unlocked.'
              : 'Something went wrong.',
      )
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{kills.toLocaleString()} kills</span>
        <span>{nextTier ? `Next: ${nextTier.toLocaleString()}` : toUnlock ? 'Unlock next tier below' : 'Maxed'}</span>
      </div>
      <div className="mt-1">
        <ProgressBar value={kills} max={nextTier ?? kills} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Reward: <span className="text-emerald-400">{tier ? `+${Math.round((multiplier - 1) * 100)}% gold` : '—'}</span>
      </p>

      {toUnlock && (
        <button
          type="button"
          disabled={busy || !affordable}
          onClick={() => void handleUnlock()}
          title={!affordable ? `Need ${toUnlock.cost.amount} ${toUnlock.cost.currency === 'meteor' ? 'Meteors' : 'DragonBalls'}` : undefined}
          className="mt-1.5 rounded-lg border border-purple-600 bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Unlock tier {unlockedTierIndex + 1} ({toUnlock.cost.amount} {toUnlock.cost.currency === 'meteor' ? 'Meteors' : 'DragonBalls'})
        </button>
      )}
      {error && <p className="mt-1 text-[11px] text-amber-400">{error}</p>}
    </div>
  )
}

function AccountLadderRow({ monsterId }: { monsterId: EnemyTypeId }) {
  const kills = useAchievementsStore((state) => state.accountKills[monsterId] ?? 0)
  // The account ladder has no paid tier-2 upgrade built yet (deliberately —
  // its own reward category is still undecided per the user), so only the
  // first three tiers ever show real progress; beyond that it's "Coming soon"
  // rather than hidden, matching this game's existing convention for
  // not-yet-built content (locked classes, locked zones).
  const nextTier = nextAchievementTier(kills, 3)
  const maxedFree = kills >= 500

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{kills.toLocaleString()} kills</span>
        <span>{maxedFree ? 'Coming soon' : nextTier ? `Next: ${nextTier.toLocaleString()}` : ''}</span>
      </div>
      <div className="mt-1">
        <ProgressBar value={kills} max={nextTier ?? kills} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Reward: not designed yet</p>
    </div>
  )
}

function MonsterRow({
  characterId,
  monsterId,
  displayName,
  ladder,
}: {
  characterId: string
  monsterId: EnemyTypeId
  displayName: string
  ladder: Ladder
}) {
  const hasPet = useAchievementsStore((state) => state.pets.has(monsterId))

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-200">{displayName}</p>
        <span className={`text-xs ${hasPet ? 'text-amber-300' : 'text-slate-600'}`}>{hasPet ? '🐾 Pet obtained' : '🔒 Pet locked'}</span>
      </div>

      <div className="mt-2">
        {ladder === 'character' ? (
          <CharacterLadderRow characterId={characterId} monsterId={monsterId} />
        ) : (
          <AccountLadderRow monsterId={monsterId} />
        )}
      </div>
    </div>
  )
}

export default function AchievementsPanel({ characterId }: { characterId: string }) {
  const [ladder, setLadder] = useState<Ladder>('character')

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Kill a monster repeatedly to climb its two ladders — your own kills, and every character on this account combined. Reaching a
        tier grants a bonus while fighting that monster (placeholder values for now). Every monster also has a 1 in{' '}
        {(1 / PET_DROP_CHANCE).toLocaleString()} chance per kill to drop its pet — account-wide, one per monster, forever.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setLadder('character')}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
            ladder === 'character'
              ? 'border-sky-500 bg-sky-500/10 text-sky-300'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Character
        </button>
        <button
          type="button"
          onClick={() => setLadder('account')}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
            ladder === 'account' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Account
        </button>
      </div>

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
                <MonsterRow
                  key={monsterId}
                  characterId={characterId}
                  monsterId={monsterId}
                  displayName={ENEMY_TYPES[monsterId].displayName}
                  ladder={ladder}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
