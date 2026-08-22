import { useState, type ReactNode } from 'react'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, zoneIdForMonster, type EnemyTypeId, type ZoneId } from '../game/zones/zoneData'
import { useAchievementsStore, type MonsterKillEntry } from '../game/achievements/useAchievementsStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import { SLOT_SIZE_CLASS } from './InventorySlot'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import GearScoreLeaderboardPanel from './GearScoreLeaderboardPanel'
import {
  ACHIEVEMENT_TIERS,
  ACCOUNT_TIER_THRESHOLDS,
  CHARACTER_TIER_REWARDS,
  describeCharacterTierReward,
  describeAccountTierReward,
  tierIndexReached,
  PET_DROP_CHANCE,
  ZONE_TIER_COMPLETIONS,
  ZONE_TIER_COMET_SCROLL_REWARD,
  ZONE_TOTAL_TIER_MILESTONES,
  zoneTierCompletions,
} from '../game/achievements/achievementData'

// Achievements & Pets — full rework (2026-08-06, confirmed with the user).
// Supersedes the earlier Character/Account/Pets-with-Zones/Quests/Prestige
// sub-tab layout entirely — see achievementData.ts and useAchievementsStore.ts
// for the mechanism rewrite this UI is built on top of.
//
// Three top-level tabs, no sub-tabs anymore (Quests was always an
// undesigned placeholder with zero content, and Prestige is gone outright —
// dropping both leaves a genuinely simpler structure, not just a reskin):
//   - {character name}: this character's own Kill Count ladder per monster,
//     grouped by zone. Each tier is a real one-time Claim.
//   - Account: the account-wide ladder (kills summed across all 5 character
//     slots), same shape, claiming grants a small permanent combat buff
//     instead of an item/currency bundle.
//   - Pets: unchanged from before this rework.
type AchievementsTab = 'player' | 'account' | 'pets' | 'leaderboard'

type ChipState = 'claimed' | 'claimable' | 'locked'

const CHIP_STATE_COLOR: Record<ChipState, string> = {
  claimed: '#34d399', // emerald-400
  claimable: '#f59e0b', // amber-500
  locked: '#475569', // slate-600
}

function chipState(tierIndex: number, claimedTierIndex: number, reachedTierIndex: number): ChipState {
  if (tierIndex < claimedTierIndex) return 'claimed'
  if (tierIndex < reachedTierIndex) return 'claimable'
  return 'locked'
}

// A small circular count badge — the "notification bubble with a number in
// it" the user asked for, reused at every level this can matter: a tab
// button, a zone's collapsed header, and an individual monster card.
function NotificationBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold leading-none text-slate-950">
      {count}
    </span>
  )
}

// How many tiers, across a zone's 5 monsters, are reached but not yet
// claimed for a given track (character or account) — feeds the zone header
// badge in CollapsibleZoneGroups. Computed as a plain function over an
// already-selected raw record, not inside a Zustand selector itself (see
// this project's own zustand-selector-pitfall convention).
function claimableCountsByZone(
  kills: Record<string, MonsterKillEntry>,
  thresholds: readonly number[],
): Partial<Record<ZoneId, number>> {
  const result: Partial<Record<ZoneId, number>> = {}
  for (const zoneId of ZONE_ORDER) {
    let total = 0
    for (const monsterId of ZONES[zoneId].monsterOrder) {
      const entry = kills[monsterId]
      if (!entry) continue
      total += Math.max(0, tierIndexReached(entry.kills, thresholds) - entry.claimedTierIndex)
    }
    if (total > 0) result[zoneId] = total
  }
  return result
}

function totalClaimable(kills: Record<string, MonsterKillEntry>, thresholds: readonly number[]): number {
  let total = 0
  for (const entry of Object.values(kills)) {
    total += Math.max(0, tierIndexReached(entry.kills, thresholds) - entry.claimedTierIndex)
  }
  return total
}

// Whether a zone has a newly-reached-but-unclaimed Zone Tier — feeds both
// the zone header badge and the top-level Claimable total, same "reached
// minus claimed" shape as the per-monster helpers above.
function zoneTierClaimableCount(
  zoneId: ZoneId,
  characterKills: Record<string, MonsterKillEntry>,
  zoneClaims: Record<string, number>,
): number {
  const zoneMonsterKills = ZONES[zoneId].monsterOrder.map((monsterId) => characterKills[monsterId]?.kills ?? 0)
  const { zoneTier } = zoneTierCompletions(zoneMonsterKills)
  const claimedZoneTier = zoneClaims[zoneId] ?? 0
  return Math.max(0, zoneTier - claimedZoneTier)
}

function totalZoneTierClaimable(characterKills: Record<string, MonsterKillEntry>, zoneClaims: Record<string, number>): number {
  let total = 0
  for (const zoneId of ZONE_ORDER) {
    total += zoneTierClaimableCount(zoneId, characterKills, zoneClaims)
  }
  return total
}

function describeClaimError(error: string | undefined, message: string | undefined): string {
  switch (error) {
    case 'already_maxed':
      return 'All tiers already claimed.'
    case 'not_reached':
      return "Kill count requirement not met yet."
    case 'no_kills_yet':
      return 'No kills recorded yet for this monster.'
    case 'no_reward_available':
      return 'No reward item available right now — try again.'
    case 'not_owner':
      return "Couldn't verify ownership — try reloading the page."
    case 'rpc_failed':
      return `Request failed: ${message ?? 'unknown error'}`
    default:
      return 'Something went wrong (no error detail returned).'
  }
}

function MonsterCard({ children, badgeCount }: { children: ReactNode; badgeCount: number }) {
  return (
    <div className="relative rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      {badgeCount > 0 && (
        <div className="absolute -right-2 -top-2">
          <NotificationBadge count={badgeCount} />
        </div>
      )}
      {children}
    </div>
  )
}

// A row of 6 chips, one per tier — claimed (emerald, checkmark), claimable
// (amber, pulsing), or locked (gray). Reused by both tracks, parametrized by
// thresholds/reward-describer since the two tracks' reward shapes differ
// entirely (item/currency bundle vs. a combat-buff percentage).
function TierChipRow({
  thresholds,
  claimedTierIndex,
  reachedTierIndex,
  describeReward,
}: {
  thresholds: readonly number[]
  claimedTierIndex: number
  reachedTierIndex: number
  describeReward: (tierIndex: number) => string
}) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {thresholds.map((threshold, tierIndex) => {
        const state = chipState(tierIndex, claimedTierIndex, reachedTierIndex)
        const color = CHIP_STATE_COLOR[state]
        const tooltip = (
          <ItemTooltip
            title={`Tier ${tierIndex + 1} · ${threshold.toLocaleString()} kills`}
            titleColor={color}
            lines={[
              `Reward: ${describeReward(tierIndex)}`,
              state === 'claimed' ? 'Claimed' : state === 'claimable' ? 'Ready to claim!' : `${threshold.toLocaleString()} kills required`,
            ]}
          />
        )
        return (
          <HoverTooltip key={threshold} content={tooltip}>
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-md border-2 text-[10px] font-semibold ${
                state === 'claimable' ? 'animate-pulse' : ''
              }`}
              style={{ borderColor: color, backgroundColor: state === 'locked' ? '#020617' : `${color}22`, color }}
            >
              {state === 'claimed' ? '✓' : tierIndex + 1}
            </div>
          </HoverTooltip>
        )
      })}
    </div>
  )
}

// Character track — one card per monster: name, kill count, the 6-chip
// ladder, and a single Claim button that only ever targets the next tier in
// sequence (the server won't let you pick which one, see
// claim_kill_count_reward). No affordability check needed anymore — unlike
// the old paid Prestige unlock, a Kill Count claim is free, the kills
// already paid for it.
function CharacterMonsterCard({ characterId, monsterId, displayName }: { characterId: string; monsterId: EnemyTypeId; displayName: string }) {
  const entry = useAchievementsStore((state) => state.characterKills[monsterId])
  const busy = useAchievementsStore((state) => state.busy)
  const claimCharacterTier = useAchievementsStore((state) => state.claimCharacterTier)
  const [error, setError] = useState<string | null>(null)

  // Fractional now (2026-08-11 expected-value rewrite — see CLAUDE.md's
  // Combat section) since resolve-combat credits partial kill progress every
  // resolve instead of only whole numbers; threshold comparisons below use
  // the raw value (crosses the instant enough progress accrues), only the
  // rendered "N kills" text floors it.
  const kills = entry?.kills ?? 0
  const claimedTierIndex = entry?.claimedTierIndex ?? 0
  const reachedTierIndex = tierIndexReached(kills, ACHIEVEMENT_TIERS)
  const claimable = reachedTierIndex > claimedTierIndex
  const maxed = claimedTierIndex >= ACHIEVEMENT_TIERS.length
  const nextThreshold = ACHIEVEMENT_TIERS[claimedTierIndex]
  const nextReward = CHARACTER_TIER_REWARDS[claimedTierIndex]

  const handleClaim = async () => {
    setError(null)
    const result = await claimCharacterTier(characterId, monsterId)
    if (!result.ok) {
      setError(describeClaimError(result.error, result.message))
    }
  }

  return (
    <MonsterCard badgeCount={claimable ? 1 : 0}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-200">{displayName}</p>
          <p className="text-[11px] text-slate-500">{Math.floor(kills).toLocaleString()} kills</p>
        </div>
        {maxed ? (
          <span className="text-[11px] font-medium text-emerald-400">All tiers claimed</span>
        ) : (
          <Button variant="primary" disabled={busy || !claimable} onClick={() => void handleClaim()} title={!claimable ? `Reach ${nextThreshold.toLocaleString()} kills` : undefined}>
            {claimable ? `Claim Tier ${claimedTierIndex + 1}` : `Tier ${claimedTierIndex + 1} at ${nextThreshold.toLocaleString()}`}
          </Button>
        )}
      </div>
      {!maxed && <p className="mt-1 text-[11px] text-slate-500">Next: {describeCharacterTierReward(nextReward)}</p>}
      <TierChipRow
        thresholds={ACHIEVEMENT_TIERS}
        claimedTierIndex={claimedTierIndex}
        reachedTierIndex={reachedTierIndex}
        describeReward={(tierIndex) => describeCharacterTierReward(CHARACTER_TIER_REWARDS[tierIndex])}
      />
      {error && <p className="mt-1.5 text-[11px] text-amber-400">{error}</p>}
    </MonsterCard>
  )
}

// Account track — mirrors CharacterMonsterCard, but the ladder is the
// account-wide one (kills summed across all 5 character slots, 5x the
// character thresholds) and the reward is a permanent attack/drop combat
// buff rather than an item/currency bundle. accountId undefined means the
// session hasn't resolved yet (a brief, disclosed edge case, same guard
// GameShell already uses before calling loadAchievements) — claiming is
// simply disabled until then.
function AccountMonsterCard({ accountId, monsterId, displayName }: { accountId: string | undefined; monsterId: EnemyTypeId; displayName: string }) {
  const entry = useAchievementsStore((state) => state.accountKills[monsterId])
  const busy = useAchievementsStore((state) => state.busy)
  const claimAccountTier = useAchievementsStore((state) => state.claimAccountTier)
  const [error, setError] = useState<string | null>(null)

  const kills = entry?.kills ?? 0
  const claimedTierIndex = entry?.claimedTierIndex ?? 0
  const reachedTierIndex = tierIndexReached(kills, ACCOUNT_TIER_THRESHOLDS)
  const claimable = reachedTierIndex > claimedTierIndex
  const maxed = claimedTierIndex >= ACCOUNT_TIER_THRESHOLDS.length
  const nextThreshold = ACCOUNT_TIER_THRESHOLDS[claimedTierIndex]
  const monsterZoneId = zoneIdForMonster(monsterId)

  const handleClaim = async () => {
    if (!accountId) return
    setError(null)
    const result = await claimAccountTier(accountId, monsterId)
    if (!result.ok) {
      setError(describeClaimError(result.error, result.message))
    }
  }

  return (
    <MonsterCard badgeCount={claimable ? 1 : 0}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-200">{displayName}</p>
          <p className="text-[11px] text-slate-500">{Math.floor(kills).toLocaleString()} kills (all characters)</p>
        </div>
        {maxed ? (
          <span className="text-[11px] font-medium text-emerald-400">All tiers claimed</span>
        ) : (
          <Button
            variant="primary"
            disabled={busy || !claimable || !accountId}
            onClick={() => void handleClaim()}
            title={!claimable ? `Reach ${nextThreshold.toLocaleString()} kills` : undefined}
          >
            {claimable ? `Claim Tier ${claimedTierIndex + 1}` : `Tier ${claimedTierIndex + 1} at ${nextThreshold.toLocaleString()}`}
          </Button>
        )}
      </div>
      {!maxed && (
        <p className="mt-1 text-[11px] text-slate-500">
          Next: {describeAccountTierReward(monsterZoneId ?? undefined, ZONE_ORDER)}
        </p>
      )}
      <TierChipRow
        thresholds={ACCOUNT_TIER_THRESHOLDS}
        claimedTierIndex={claimedTierIndex}
        reachedTierIndex={reachedTierIndex}
        describeReward={() => describeAccountTierReward(monsterZoneId ?? undefined, ZONE_ORDER)}
      />
      {error && <p className="mt-1.5 text-[11px] text-amber-400">{error}</p>}
    </MonsterCard>
  )
}

// Redesigned (2026-08-01, supersedes the earlier flat name+badge list row) to
// read as a tile grid, matching the Inventory/Forge/Bank tile
// convention (same SLOT_SIZE_CLASS, same universal hover tooltip) rather than
// a plain list — an obtained pet gets a colored, glowing tile; a locked one
// stays dim, same "special vs. mundane" visual language as gear quality tiers.
// Unaffected by the 2026-08-06 rework.
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

// Zone-level Achievements milestone bar — this is the additive per-zone
// Comet Scroll ladder, separate from the per-monster Kill Count ladder
// above; see achievementData.ts. Each dot's state now reflects three things
// (2026-08-15, reworked alongside the zone reward becoming a real Claim
// button below, instead of resolve-combat silently auto-granting it): a
// dot the player has actually claimed (emerald), one that's reached but not
// yet claimed (pulsing amber, matching the per-monster chip row), or one
// still locked (gray).
function ZoneMilestoneBar({ zoneId }: { zoneId: ZoneId }) {
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const claimedZoneTier = useAchievementsStore((state) => state.zoneClaims[zoneId] ?? 0)
  const zoneMonsterKills = ZONES[zoneId].monsterOrder.map((monsterId) => characterKills[monsterId]?.kills ?? 0)
  const { completions, zoneTier } = zoneTierCompletions(zoneMonsterKills)
  const overallPct = (completions / ZONE_TOTAL_TIER_MILESTONES) * 100

  return (
    <div className="w-40" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {completions}/{ZONE_TOTAL_TIER_MILESTONES}
        </span>
        {claimedZoneTier > 0 && <span className="text-emerald-400">Zone Tier {claimedZoneTier}</span>}
      </div>
      <div className="relative py-1.5">
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-sky-500 transition-[width]" style={{ width: `${overallPct}%` }} />
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center">
          {ZONE_TIER_COMPLETIONS.map((threshold, index) => {
            const state = chipState(index, claimedZoneTier, zoneTier)
            const color = CHIP_STATE_COLOR[state]
            const leftPct = (threshold / ZONE_TOTAL_TIER_MILESTONES) * 100

            const tooltip = (
              <ItemTooltip
                title={`Zone Tier ${index + 1} · ${threshold} completions`}
                titleColor={color}
                lines={[
                  `Reward: ${ZONE_TIER_COMET_SCROLL_REWARD[index]} Comet Scroll${ZONE_TIER_COMET_SCROLL_REWARD[index] === 1 ? '' : 's'}`,
                  state === 'claimed' ? 'Claimed' : state === 'claimable' ? 'Ready to claim!' : `${(threshold - completions).toLocaleString()} to go`,
                ]}
              />
            )

            return (
              <div key={threshold} className="pointer-events-auto absolute -translate-x-1/2" style={{ left: `${leftPct}%` }}>
                <HoverTooltip content={tooltip}>
                  <div
                    className={`h-3 w-3 rounded-full border-2 ${state === 'claimable' ? 'animate-pulse' : ''}`}
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
    </div>
  )
}

// Zone Tier's own Claim button (2026-08-15) — mirrors CharacterMonsterCard's
// Claim button shape: always targets the next zone tier in sequence, free
// (the zone's tier-completion count is itself the cost), server-verified via
// claim_zone_tier_reward rather than trusted from this component's own
// display math. Supersedes the old behavior where resolve-combat silently
// granted the Comet Scroll reward straight into the character's currency the
// moment a zone tier was crossed mid-fight — confusing since nothing on
// screen explained why a Comet Scroll count had gone up.
function ZoneTierClaimSection({ characterId, zoneId }: { characterId: string; zoneId: ZoneId }) {
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const claimedZoneTier = useAchievementsStore((state) => state.zoneClaims[zoneId] ?? 0)
  const busy = useAchievementsStore((state) => state.busy)
  const claimZoneTier = useAchievementsStore((state) => state.claimZoneTier)
  const [error, setError] = useState<string | null>(null)

  const zoneMonsterKills = ZONES[zoneId].monsterOrder.map((monsterId) => characterKills[monsterId]?.kills ?? 0)
  const { zoneTier: reachedZoneTier } = zoneTierCompletions(zoneMonsterKills)
  const claimable = reachedZoneTier > claimedZoneTier
  const maxed = claimedZoneTier >= ZONE_TIER_COMPLETIONS.length
  const nextThreshold = ZONE_TIER_COMPLETIONS[claimedZoneTier]
  const nextReward = ZONE_TIER_COMET_SCROLL_REWARD[claimedZoneTier]

  if (maxed) {
    return <p className="mt-1 text-[11px] font-medium text-emerald-400">All Zone Tiers claimed</p>
  }

  const handleClaim = async () => {
    setError(null)
    const result = await claimZoneTier(characterId, zoneId)
    if (!result.ok) {
      setError(describeClaimError(result.error, result.message))
    }
  }

  return (
    <div className="mt-1.5" onClick={(event) => event.stopPropagation()}>
      <Button
        variant="primary"
        disabled={busy || !claimable}
        onClick={() => void handleClaim()}
        title={!claimable ? `Reach ${nextThreshold} zone-tier completions` : undefined}
      >
        {claimable
          ? `Claim Zone Tier ${claimedZoneTier + 1} (+${nextReward} Comet Scroll${nextReward === 1 ? '' : 's'})`
          : `Zone Tier ${claimedZoneTier + 1} at ${nextThreshold} completions`}
      </Button>
      {error && <p className="mt-1.5 text-[11px] text-amber-400">{error}</p>}
    </div>
  )
}

// Each zone starts collapsed and only shows its monster rows once selected
// — an accordion (one zone open at a time). Now also shows a claimable-count
// notification badge next to the zone name when it has any pending claims.
function CollapsibleZoneGroups({
  expandedZoneId,
  onToggleZone,
  renderMonster,
  showZoneSummary,
  claimableByZone,
  renderZoneExtra,
  renderZoneClaim,
}: {
  expandedZoneId: ZoneId | null
  onToggleZone: (zoneId: ZoneId) => void
  renderMonster: (monsterId: EnemyTypeId, displayName: string) => ReactNode
  // Only the Character tab's own Zones passes this — the Fallen Star zone
  // ladder is scoped to one character, so Account shouldn't show it.
  showZoneSummary?: boolean
  claimableByZone?: Partial<Record<ZoneId, number>>
  // Only the Account tab passes this (2026-08-07, confirmed with the user:
  // "display these zones as cards and display the current achieved bonus")
  // — the zone's own Attack/Quality combat-bonus totals, shown right on the
  // collapsed card so they're visible without expanding it. Replaces the
  // old standalone "Combat bonuses by zone" summary block that used to sit
  // above this whole list.
  renderZoneExtra?: (zoneId: ZoneId) => ReactNode
  // Only the Character tab's own Zones passes this (2026-08-15) — the Zone
  // Tier Claim button, rendered right under ZoneMilestoneBar. A real <button>
  // element, so it can't nest inside the header's own toggle control below
  // (that control was switched from a <button> to a <div role="button"> for
  // exactly this reason).
  renderZoneClaim?: (zoneId: ZoneId) => ReactNode
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

        const expanded = expandedZoneId === zoneId
        const zoneBadgeCount = claimableByZone?.[zoneId] ?? 0

        return (
          <AscensionCard key={zoneId} className="overflow-hidden" contentClassName="p-0">
            <div
              role="button"
              tabIndex={0}
              onClick={() => onToggleZone(zoneId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onToggleZone(zoneId)
                }
              }}
              className="flex w-full cursor-pointer items-center justify-between p-4 text-left"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-200">{zone.displayName}</p>
                  <NotificationBadge count={zoneBadgeCount} />
                </div>
                {showZoneSummary && (
                  <div className="mt-1">
                    <ZoneMilestoneBar zoneId={zoneId} />
                  </div>
                )}
                {renderZoneClaim && renderZoneClaim(zoneId)}
                {renderZoneExtra && <div className="mt-1">{renderZoneExtra(zoneId)}</div>}
              </div>
              <span className={`text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
            </div>
            {expanded && (
              <div className="space-y-2 border-t border-slate-800 p-4 pt-3">
                {rows.map((entry) => (
                  <div key={entry.monsterId}>{entry.node}</div>
                ))}
              </div>
            )}
          </AscensionCard>
        )
      })}
    </>
  )
}

// Grid-only zone shell for Pets — the one remaining always-expanded (not
// collapsible) zone grouping, since its tile grid is compact enough per zone
// not to need hiding.
function PetZoneGroups({ renderMonster }: { renderMonster: (monsterId: EnemyTypeId, displayName: string) => ReactNode }) {
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
          <AscensionCard key={zoneId} title={zone.displayName}>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
              {rows.map((entry) => (
                <div key={entry.monsterId}>{entry.node}</div>
              ))}
            </div>
          </AscensionCard>
        )
      })}
    </>
  )
}

function PlayerTabContent({ characterId }: { characterId: string }) {
  const [expandedZoneId, setExpandedZoneId] = useState<ZoneId | null>(null)
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const zoneClaims = useAchievementsStore((state) => state.zoneClaims)
  const claimableByZone = claimableCountsByZone(characterKills, ACHIEVEMENT_TIERS)
  for (const zoneId of ZONE_ORDER) {
    const zoneTierExtra = zoneTierClaimableCount(zoneId, characterKills, zoneClaims)
    if (zoneTierExtra > 0) claimableByZone[zoneId] = (claimableByZone[zoneId] ?? 0) + zoneTierExtra
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Kill a monster to climb its personal ladder — each of the 6 tiers is a real, one-time claim. Tap a zone to expand it.
      </p>
      <CollapsibleZoneGroups
        expandedZoneId={expandedZoneId}
        onToggleZone={(zoneId) => setExpandedZoneId((current) => (current === zoneId ? null : zoneId))}
        showZoneSummary
        claimableByZone={claimableByZone}
        renderZoneClaim={(zoneId) => <ZoneTierClaimSection characterId={characterId} zoneId={zoneId} />}
        renderMonster={(monsterId, displayName) => (
          <CharacterMonsterCard characterId={characterId} monsterId={monsterId} displayName={displayName} />
        )}
      />
    </div>
  )
}

// The zone card's own "Attack +X% · Quality +Y%" line (2026-08-07, confirmed
// with the user — replaces the old standalone "Combat bonuses by zone" list
// that used to sit above the whole card list). Renders nothing for a zone
// with no claims yet, rather than a "+0%" line for every unclaimed zone.
function ZoneBonusLine({ zoneId }: { zoneId: ZoneId }) {
  const attackBonusPct = usePlayerRecordStore((state) => state.accountZoneAttackBonusPct[zoneId] ?? 0)
  const dropBonusPct = usePlayerRecordStore((state) => state.accountZoneDropBonusPct[zoneId] ?? 0)

  if (attackBonusPct <= 0 && dropBonusPct <= 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
      <span>
        Attack <span className="font-semibold text-emerald-400">+{attackBonusPct}%</span>
      </span>
      <span>
        Quality <span className="font-semibold text-emerald-400">+{dropBonusPct}%</span>
      </span>
    </div>
  )
}

function AccountTabContent({ accountId }: { accountId: string | undefined }) {
  const [expandedZoneId, setExpandedZoneId] = useState<ZoneId | null>(null)
  const accountKills = useAchievementsStore((state) => state.accountKills)
  const claimableByZone = claimableCountsByZone(accountKills, ACCOUNT_TIER_THRESHOLDS)

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Every character on this account contributes to the same ladder per monster (thresholds are 5x the character track's own). Claiming
        grants a small, permanent combat buff — active only while fighting in that monster's own zone.
      </p>
      <CollapsibleZoneGroups
        expandedZoneId={expandedZoneId}
        onToggleZone={(zoneId) => setExpandedZoneId((current) => (current === zoneId ? null : zoneId))}
        claimableByZone={claimableByZone}
        renderZoneExtra={(zoneId) => <ZoneBonusLine zoneId={zoneId} />}
        renderMonster={(monsterId, displayName) => <AccountMonsterCard accountId={accountId} monsterId={monsterId} displayName={displayName} />}
      />
    </div>
  )
}

const TAB_DESCRIPTIONS: Record<AchievementsTab, string> = {
  player: 'This character’s own Kill Count achievements.',
  account: 'Progress shared across every character on this account.',
  pets: `Every monster has a 1 in ${(1 / PET_DROP_CHANCE).toLocaleString()} chance per kill to drop its pet — account-wide, one per monster, forever.`,
  leaderboard: 'See who has the top Gear Score for each class, and inspect their loadout.',
}

export default function AchievementsPanel({ characterId, accountId }: { characterId: string; accountId?: string }) {
  const characterName = useCharacterRecordStore((state) => state.characterName)
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const accountKills = useAchievementsStore((state) => state.accountKills)
  const zoneClaims = useAchievementsStore((state) => state.zoneClaims)
  const pets = useAchievementsStore((state) => state.pets)
  const [tab, setTab] = useState<AchievementsTab>('player')

  const characterClaimable = totalClaimable(characterKills, ACHIEVEMENT_TIERS) + totalZoneTierClaimable(characterKills, zoneClaims)
  const accountClaimable = totalClaimable(accountKills, ACCOUNT_TIER_THRESHOLDS)

  const TABS: { id: AchievementsTab; label: string; badge: number }[] = [
    { id: 'player', label: characterName || 'Character', badge: characterClaimable },
    { id: 'account', label: 'Account', badge: accountClaimable },
    { id: 'pets', label: 'Pets', badge: 0 },
    { id: 'leaderboard', label: 'Leaderboard', badge: 0 },
  ]

  return (
    <div className="space-y-4">
      <AscensionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Track progress and claim one-time rewards for grinding a monster.</p>
          <div className="flex gap-4 text-xs text-slate-400">
            <span>
              Pets: <span className="font-semibold text-amber-300">{pets.size}</span> / 40
            </span>
            <span>
              Claimable: <span className="font-semibold text-amber-300">{characterClaimable + accountClaimable}</span>
            </span>
          </div>
        </div>
      </AscensionCard>

      <p className="text-xs text-slate-500">{TAB_DESCRIPTIONS[tab]}</p>

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              tab === item.id ? 'border-amber-400 bg-amber-500/10 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-amber-500/50'
            }`}
          >
            {item.label}
            <NotificationBadge count={item.badge} />
          </button>
        ))}
      </div>

      {tab === 'player' && <PlayerTabContent characterId={characterId} />}

      {tab === 'account' && <AccountTabContent accountId={accountId} />}

      {tab === 'pets' && <PetZoneGroups renderMonster={(monsterId, displayName) => <PetTile monsterId={monsterId} displayName={displayName} />} />}

      {tab === 'leaderboard' && <GearScoreLeaderboardPanel characterId={characterId} />}
    </div>
  )
}
