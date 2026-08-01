import { useState, type ReactNode } from 'react'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId } from '../game/zones/zoneData'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
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
//
// Four tabs (confirmed with the user, 2026-08-01 — supersedes the earlier
// two-button Character/Account switcher, which mixed progress display and the
// "pay to unlock" action into the same per-monster row):
//   - {Character name}: this character's own kill-count ladder, pure
//     progress display (kills, current reward). No unlock button here
//     anymore — see Unlocks. Eventually also home to a broader set of
//     character-level rewards ("currency, EXP, etc. based on certain
//     criteria" — confirmed as an intent, not yet designed; nothing invented
//     here for that).
//   - Account: the account-wide ladder, same progress-only display.
//   - Unlocks: every monster with a next tier available to buy for this
//     character, in one place, instead of hunting through each monster's row
//     on the character tab to find the buy button.
//   - Pets: every monster's pet status (obtained/locked), pulled out of the
//     inline per-row badge it used to be.
type AchievementsTab = 'player' | 'account' | 'unlocks' | 'pets'

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 100
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

function MonsterCard({ displayName, children }: { displayName: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-sm font-medium text-slate-200">{displayName}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

// Pure progress display — no unlock button here anymore, see UnlockRow.
function CharacterProgress({ monsterId }: { monsterId: EnemyTypeId }) {
  const characterEntry = useAchievementsStore((state) => state.characterKills[monsterId])
  const kills = characterEntry?.kills ?? 0
  const unlockedTierIndex = characterEntry?.unlockedTierIndex ?? 0

  const tier = currentAchievementTier(kills, unlockedTierIndex)
  const nextTier = nextAchievementTier(kills, unlockedTierIndex)
  const multiplier = tier ? ACHIEVEMENT_GOLD_MULTIPLIER[tier] : 1
  const toUnlock = nextTierToUnlock(unlockedTierIndex)

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{kills.toLocaleString()} kills</span>
        <span>{nextTier ? `Next: ${nextTier.toLocaleString()}` : toUnlock ? 'Unlock next tier in Unlocks' : 'Maxed'}</span>
      </div>
      <div className="mt-1">
        <ProgressBar value={kills} max={nextTier ?? kills} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Reward: <span className="text-emerald-400">{tier ? `+${Math.round((multiplier - 1) * 100)}% gold` : '—'}</span>
      </p>
    </div>
  )
}

function AccountProgress({ monsterId }: { monsterId: EnemyTypeId }) {
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

// Only renders for a monster that actually has a next tier to buy — fully
// maxed (tier 6) monsters simply don't show up on this tab at all.
function UnlockRow({ characterId, monsterId, displayName }: { characterId: string; monsterId: EnemyTypeId; displayName: string }) {
  const characterEntry = useAchievementsStore((state) => state.characterKills[monsterId])
  const busy = useAchievementsStore((state) => state.busy)
  const unlockNextTier = useAchievementsStore((state) => state.unlockNextTier)
  const meteors = useCurrencyStore((state) => state.meteors)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)

  const [error, setError] = useState<string | null>(null)

  const kills = characterEntry?.kills ?? 0
  const unlockedTierIndex = characterEntry?.unlockedTierIndex ?? 0
  const toUnlock = nextTierToUnlock(unlockedTierIndex)
  const affordable = toUnlock ? (toUnlock.cost.currency === 'meteor' ? meteors : dragonballs) >= toUnlock.cost.amount : false

  if (!toUnlock) {
    return null
  }

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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div>
        <p className="text-sm font-medium text-slate-200">{displayName}</p>
        <p className="text-[11px] text-slate-500">
          {kills.toLocaleString()} kills · tier {unlockedTierIndex + 1} of 6
        </p>
      </div>
      <div className="text-right">
        <button
          type="button"
          disabled={busy || !affordable}
          onClick={() => void handleUnlock()}
          title={!affordable ? `Need ${toUnlock.cost.amount} ${toUnlock.cost.currency === 'meteor' ? 'Meteors' : 'DragonBalls'}` : undefined}
          className="rounded-lg border border-purple-600 bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Unlock tier {unlockedTierIndex + 1} ({toUnlock.cost.amount} {toUnlock.cost.currency === 'meteor' ? 'Meteors' : 'DragonBalls'})
        </button>
        {error && <p className="mt-1 text-[11px] text-amber-400">{error}</p>}
      </div>
    </div>
  )
}

function PetRow({ monsterId, displayName }: { monsterId: EnemyTypeId; displayName: string }) {
  const hasPet = useAchievementsStore((state) => state.pets.has(monsterId))

  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-sm font-medium text-slate-200">{displayName}</p>
      <span className={`text-xs ${hasPet ? 'text-amber-300' : 'text-slate-600'}`}>{hasPet ? '🐾 Obtained' : '🔒 Locked'}</span>
    </div>
  )
}

// Shared "grouped by zone" shell — every tab renders the same zone structure,
// just with a different per-monster row renderer.
function ZoneGroups({ renderMonster }: { renderMonster: (monsterId: EnemyTypeId, displayName: string) => ReactNode }) {
  return (
    <>
      {ZONE_ORDER.map((zoneId) => {
        const zone = ZONES[zoneId]
        if (zone.monsterOrder.length === 0) {
          return null
        }

        const rows = zone.monsterOrder
          .map((monsterId) => ({ monsterId, node: renderMonster(monsterId, ENEMY_TYPES[monsterId].displayName) }))
          .filter((entry) => entry.node !== null)

        if (rows.length === 0) {
          return null
        }

        return (
          <div key={zoneId} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <p className="text-sm font-medium text-slate-200">{zone.displayName}</p>
            <div className="mt-2 space-y-2">{rows.map((entry) => <div key={entry.monsterId}>{entry.node}</div>)}</div>
          </div>
        )
      })}
    </>
  )
}

const TAB_DESCRIPTIONS: Record<AchievementsTab, string> = {
  player: 'Kill a monster repeatedly to climb its personal ladder. Reaching a tier grants a bonus while fighting that monster (placeholder values for now).',
  account: 'Every character on this account contributes to the same account-wide ladder per monster — its own reward category is still being designed.',
  unlocks: 'Spend Meteors/DragonBalls to unlock the next tier on a monster’s personal ladder. Unlocking ahead of your kill count is fine — the reward just won’t be active until you catch up.',
  pets: `Every monster has a 1 in ${(1 / PET_DROP_CHANCE).toLocaleString()} chance per kill to drop its pet — account-wide, one per monster, forever.`,
}

export default function AchievementsPanel({ characterId }: { characterId: string }) {
  const characterName = useCharacterRecordStore((state) => state.characterName)
  const [tab, setTab] = useState<AchievementsTab>('player')

  const TABS: { id: AchievementsTab; label: string }[] = [
    { id: 'player', label: characterName || 'Character' },
    { id: 'account', label: 'Account' },
    { id: 'unlocks', label: 'Unlocks' },
    { id: 'pets', label: 'Pets' },
  ]

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{TAB_DESCRIPTIONS[tab]}</p>

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              tab === item.id ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'player' && (
        <ZoneGroups
          renderMonster={(monsterId, displayName) => (
            <MonsterCard displayName={displayName}>
              <CharacterProgress monsterId={monsterId} />
            </MonsterCard>
          )}
        />
      )}

      {tab === 'account' && (
        <ZoneGroups
          renderMonster={(monsterId, displayName) => (
            <MonsterCard displayName={displayName}>
              <AccountProgress monsterId={monsterId} />
            </MonsterCard>
          )}
        />
      )}

      {tab === 'unlocks' && (
        <ZoneGroups
          renderMonster={(monsterId, displayName) => <UnlockRow characterId={characterId} monsterId={monsterId} displayName={displayName} />}
        />
      )}

      {tab === 'pets' && (
        <ZoneGroups renderMonster={(monsterId, displayName) => <PetRow monsterId={monsterId} displayName={displayName} />} />
      )}
    </div>
  )
}
