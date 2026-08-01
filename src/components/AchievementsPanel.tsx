import { useState, type ReactNode } from 'react'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId } from '../game/zones/zoneData'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import { SLOT_SIZE_CLASS } from './InventorySlot'
import {
  ACHIEVEMENT_GOLD_MULTIPLIER,
  ACHIEVEMENT_TIERS,
  PET_DROP_CHANCE,
  currentAchievementTier,
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

type TierVisualState = 'active' | 'partial' | 'locked'

// active = reward genuinely live right now. partial = the kill count is
// there but the reward isn't (character: paid-unlock still pending; account:
// no reward category exists at all yet, see CLAUDE.md). locked = kill count
// not reached yet. Three states, one color language, reused by both ladders.
const TIER_STATE_COLOR: Record<TierVisualState, string> = {
  active: '#34d399', // emerald-400
  partial: '#f59e0b', // amber-500
  locked: '#475569', // slate-600
}

function MonsterCard({ displayName, children }: { displayName: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-sm font-medium text-slate-200">{displayName}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

// A single continuous progress bar spanning all 6 tiers (not one bar per
// tier) with a small marker dot at each tier's boundary — confirmed with the
// user (2026-08-01), replacing the earlier "just the next tier's own 0-100%
// bar" version, which showed no sense of where you stood on the ladder as a
// whole or what any tier beyond the next one actually paid out. Hovering a
// dot shows that tier's own reward via the same universal ItemTooltip every
// other tile in this game already uses.
function TierLadderBar({
  kills,
  getState,
  getTooltipLines,
}: {
  kills: number
  getState: (tierIndex: number) => TierVisualState
  getTooltipLines: (tierIndex: number, state: TierVisualState) => string[]
}) {
  // Overall fill = how far across the *whole* ladder, not just the current
  // tier — each of the 6 tiers contributes an equal 1/6 share regardless of
  // how far apart its kill thresholds are (100 to 250 vs. 5000 to 10000),
  // since a linear kill-count scale would squash every early tier invisibly
  // small next to the later ones.
  let filledSegments = 0
  for (let index = 0; index < ACHIEVEMENT_TIERS.length; index += 1) {
    const threshold = ACHIEVEMENT_TIERS[index]
    const prevThreshold = index === 0 ? 0 : ACHIEVEMENT_TIERS[index - 1]
    filledSegments += Math.max(0, Math.min(1, (kills - prevThreshold) / (threshold - prevThreshold)))
  }
  const overallPct = (filledSegments / ACHIEVEMENT_TIERS.length) * 100

  return (
    <div className="relative py-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-sky-500 transition-[width]" style={{ width: `${overallPct}%` }} />
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center">
        {ACHIEVEMENT_TIERS.map((threshold, index) => {
          const state = getState(index)
          const color = TIER_STATE_COLOR[state]
          const leftPct = ((index + 1) / ACHIEVEMENT_TIERS.length) * 100

          const tooltip = (
            <ItemTooltip
              title={`Tier ${index + 1} · ${threshold.toLocaleString()} kills`}
              titleColor={color}
              lines={getTooltipLines(index, state)}
            />
          )

          return (
            <div
              key={threshold}
              className="pointer-events-auto absolute -translate-x-1/2"
              style={{ left: `${leftPct}%` }}
            >
              <HoverTooltip content={tooltip}>
                <div
                  className={`h-2.5 w-2.5 rounded-full border-2 ${state === 'active' ? 'accent-glow' : ''}`}
                  style={{
                    borderColor: color,
                    backgroundColor: state === 'locked' ? '#020617' : color,
                    color,
                  }}
                />
              </HoverTooltip>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Pure progress display — no unlock button here anymore, see UnlockRow.
function CharacterProgress({ monsterId }: { monsterId: EnemyTypeId }) {
  const characterEntry = useAchievementsStore((state) => state.characterKills[monsterId])
  const kills = characterEntry?.kills ?? 0
  const unlockedTierIndex = characterEntry?.unlockedTierIndex ?? 0

  const tier = currentAchievementTier(kills, unlockedTierIndex)
  const activePct = tier ? Math.round((ACHIEVEMENT_GOLD_MULTIPLIER[tier] - 1) * 100) : 0

  const getState = (tierIndex: number): TierVisualState => {
    const threshold = ACHIEVEMENT_TIERS[tierIndex]
    if (kills < threshold) return 'locked'
    return tierIndex < unlockedTierIndex ? 'active' : 'partial'
  }

  const getTooltipLines = (tierIndex: number, state: TierVisualState): string[] => {
    const threshold = ACHIEVEMENT_TIERS[tierIndex]
    const rewardPct = Math.round((ACHIEVEMENT_GOLD_MULTIPLIER[threshold] - 1) * 100)
    const rewardLine = `Reward: +${rewardPct}% gold`
    if (state === 'active') return [rewardLine, 'Active now']
    if (state === 'partial') return [rewardLine, 'Reached — unlock this tier in Unlocks to activate']
    return [rewardLine, `${(threshold - kills).toLocaleString()} kills to go`]
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{kills.toLocaleString()} kills</span>
        <span className={tier ? 'text-emerald-400' : ''}>{tier ? `+${activePct}% gold active` : 'No tier active yet'}</span>
      </div>
      <div className="mt-1.5">
        <TierLadderBar kills={kills} getState={getState} getTooltipLines={getTooltipLines} />
      </div>
    </div>
  )
}

function AccountProgress({ monsterId }: { monsterId: EnemyTypeId }) {
  const kills = useAchievementsStore((state) => state.accountKills[monsterId] ?? 0)

  // The account ladder has no paid tier-2 upgrade built yet, and its reward
  // category is entirely undecided per CLAUDE.md — every tier a kill count
  // reaches shows as 'partial' (progress made, nothing to activate), never
  // 'active'. Tiers past the first 3 (1000/5000/10000) are flagged in their
  // own tooltip as needing an account-wide upgrade that doesn't exist yet,
  // matching this game's existing convention for not-yet-built content
  // (locked classes, locked zones) rather than hiding them outright.
  const getState = (tierIndex: number): TierVisualState => {
    const threshold = ACHIEVEMENT_TIERS[tierIndex]
    return kills >= threshold ? 'partial' : 'locked'
  }

  const getTooltipLines = (tierIndex: number, state: TierVisualState): string[] => {
    const threshold = ACHIEVEMENT_TIERS[tierIndex]
    const lines =
      tierIndex < 3
        ? ['Reward: not decided yet']
        : ['Reward: not decided yet', 'Needs an account-wide upgrade — not built yet']
    lines.push(state === 'locked' ? `${(threshold - kills).toLocaleString()} kills to go` : 'Reached')
    return lines
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{kills.toLocaleString()} kills</span>
        <span>Reward: not designed yet</span>
      </div>
      <div className="mt-1.5">
        <TierLadderBar kills={kills} getState={getState} getTooltipLines={getTooltipLines} />
      </div>
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

  const rewardPct = Math.round((ACHIEVEMENT_GOLD_MULTIPLIER[toUnlock.tier] - 1) * 100)
  const tooltip = (
    <ItemTooltip
      title={`Tier ${unlockedTierIndex + 1} · ${toUnlock.tier.toLocaleString()} kills`}
      titleColor="#f59e0b"
      lines={[`Reward: +${rewardPct}% gold`, 'Becomes active once you reach the kill count']}
    />
  )

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
              : result.error === 'not_owner'
                ? "Couldn't verify this character owns that — try reloading the page."
                : result.error === 'rpc_failed'
                  ? `Request failed: ${result.message ?? 'unknown error'}`
                  : 'Something went wrong (no error detail returned).',
      )
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <HoverTooltip content={tooltip}>
        <div className="cursor-help">
          <p className="text-sm font-medium text-slate-200">{displayName}</p>
          <p className="text-[11px] text-slate-500">
            {kills.toLocaleString()} kills · tier {unlockedTierIndex + 1} of 6
          </p>
        </div>
      </HoverTooltip>
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

// Redesigned (2026-08-01, supersedes the earlier flat name+badge list row) to
// read as a tile grid, matching the Inventory/Forge/Warehouse tile
// convention (same SLOT_SIZE_CLASS, same universal hover tooltip) rather than
// a plain list — an obtained pet gets a colored, glowing tile; a locked one
// stays dim, same "special vs. mundane" visual language as gear quality tiers.
function PetTile({ monsterId, displayName }: { monsterId: EnemyTypeId; displayName: string }) {
  const hasPet = useAchievementsStore((state) => state.pets.has(monsterId))
  const color = hasPet ? '#F0B87A' : '#475569'

  const tooltip = (
    <ItemTooltip
      title={displayName}
      titleColor={color}
      lines={[hasPet ? 'Obtained' : 'Locked', `1 in ${(1 / PET_DROP_CHANCE).toLocaleString()} chance per kill, account-wide`]}
    />
  )

  return (
    <HoverTooltip content={tooltip}>
      <div className="flex flex-col items-center gap-1.5">
        <div
          className={`flex ${SLOT_SIZE_CLASS} items-center justify-center rounded-lg border-2 text-2xl ${
            hasPet ? 'accent-glow' : 'opacity-50'
          }`}
          style={{ borderColor: color, backgroundColor: hasPet ? `${color}22` : 'rgba(15, 23, 42, 0.6)', color }}
        >
          {hasPet ? '🐾' : '🔒'}
        </div>
        <p className="w-16 truncate text-center text-[10px] text-slate-500">{displayName}</p>
      </div>
    </HoverTooltip>
  )
}

// Shared "grouped by zone" shell — every tab renders the same zone structure,
// just with a different per-monster row renderer. `layout="grid"` (Pets
// only) renders a tile grid instead of a vertical list of rows.
function ZoneGroups({
  renderMonster,
  layout = 'list',
}: {
  renderMonster: (monsterId: EnemyTypeId, displayName: string) => ReactNode
  layout?: 'list' | 'grid'
}) {
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
            <div className={layout === 'grid' ? 'mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8' : 'mt-2 space-y-2'}>
              {rows.map((entry) => (
                <div key={entry.monsterId}>{entry.node}</div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

const TAB_DESCRIPTIONS: Record<AchievementsTab, string> = {
  player: 'Kill a monster repeatedly to climb its personal ladder. Hover a tier marker to see its reward.',
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
        <ZoneGroups layout="grid" renderMonster={(monsterId, displayName) => <PetTile monsterId={monsterId} displayName={displayName} />} />
      )}
    </div>
  )
}
