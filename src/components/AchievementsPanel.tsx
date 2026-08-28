import { Fragment, useState, type CSSProperties, type ReactNode } from 'react'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, zoneIdForMonster, type EnemyTypeId, type ZoneId } from '../game/zones/zoneData'
import { useAchievementsStore, type MonsterKillEntry } from '../game/achievements/useAchievementsStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import { SLOT_SIZE_CLASS } from './InventorySlot'
import { AscensionCard } from './ui/AscensionCard'
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

type TierSegmentState = 'claimed' | 'claimable' | 'locked'

const TIER_SEGMENT_STATE_COLOR: Record<TierSegmentState, string> = {
  claimed: '#34d399', // emerald-400
  claimable: '#f59e0b', // amber-500
  locked: '#475569', // slate-600
}

function tierSegmentState(tierIndex: number, claimedTierIndex: number, reachedTierIndex: number): TierSegmentState {
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

const TIER_SEGMENT_CLAIMED_STYLE = { '--glow-bright': '#6ee7b7', '--glow-base': '#34d399', '--glow-dark': '#047857' } as CSSProperties

// A single full-width rectangle of 6 segments (one per tier), separated by a
// chevron divider — replaces the old small circular chip row and, for the
// zone-level ladder, the old blue/green milestone bar (2026-08-28 redesign,
// requested by the user: "an ugly blue/green indicator"). A locked segment is
// a plain inert box; once its threshold is reached it "turns into" a real
// button using the app's own CTA styling (.btn-gold) and becomes clickable —
// clicking claims whichever tier is next in sequence server-side (the RPCs
// never let a specific tier be picked, see claim_kill_count_reward), so every
// currently-claimable segment triggers the same onClaim call. Reused by the
// per-monster ladder (Character/Account tracks) and the per-zone Zone Tier
// ladder alike, parametrized since their thresholds/rewards/claim RPCs all
// differ.
function TierSegmentBar({
  thresholds,
  claimedTierIndex,
  reachedTierIndex,
  describeReward,
  formatThreshold,
  busy,
  onClaim,
}: {
  thresholds: readonly number[]
  claimedTierIndex: number
  reachedTierIndex: number
  describeReward: (tierIndex: number) => string
  formatThreshold: (threshold: number) => string
  busy: boolean
  onClaim: () => Promise<{ ok: boolean; error?: string; message?: string }>
}) {
  const [error, setError] = useState<string | null>(null)

  const handleClaim = async () => {
    setError(null)
    const result = await onClaim()
    if (!result.ok) {
      setError(describeClaimError(result.error, result.message))
    }
  }

  return (
    <div className="mt-2 w-full">
      <div className="flex w-full items-center">
        {thresholds.map((threshold, tierIndex) => {
          const state = tierSegmentState(tierIndex, claimedTierIndex, reachedTierIndex)
          const color = TIER_SEGMENT_STATE_COLOR[state]
          const tooltip = (
            <ItemTooltip
              title={`Tier ${tierIndex + 1} · ${formatThreshold(threshold)}`}
              titleColor={color}
              lines={[
                `Reward: ${describeReward(tierIndex)}`,
                state === 'claimed' ? 'Claimed' : state === 'claimable' ? 'Ready to claim — tap to claim!' : `${formatThreshold(threshold)} required`,
              ]}
            />
          )

          return (
            <Fragment key={threshold}>
              {tierIndex > 0 && (
                <span className="mx-0.5 shrink-0 select-none text-xs leading-none text-slate-600">❯</span>
              )}
              <div className="min-w-0 flex-1">
                <HoverTooltip content={tooltip}>
                  {state === 'claimable' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleClaim()}
                      className="btn-gold h-8 w-full min-w-0 animate-pulse rounded-md text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {tierIndex + 1}
                    </button>
                  ) : state === 'claimed' ? (
                    <div
                      style={TIER_SEGMENT_CLAIMED_STYLE}
                      className="btn-glow flex h-8 w-full min-w-0 items-center justify-center rounded-md text-[11px] font-bold"
                    >
                      ✓
                    </div>
                  ) : (
                    <div className="flex h-8 w-full min-w-0 items-center justify-center rounded-md border border-slate-700 bg-slate-950/60 text-[11px] font-semibold text-slate-500">
                      {tierIndex + 1}
                    </div>
                  )}
                </HoverTooltip>
              </div>
            </Fragment>
          )
        })}
      </div>
      {error && <p className="mt-1.5 text-[11px] text-amber-400">{error}</p>}
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
  const nextReward = CHARACTER_TIER_REWARDS[claimedTierIndex]

  return (
    <MonsterCard badgeCount={claimable ? 1 : 0}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-200">{displayName}</p>
        <p className="text-[11px] text-slate-500">{Math.floor(kills).toLocaleString()} kills</p>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {maxed ? <span className="font-medium text-emerald-400">All tiers claimed</span> : <>Next: {describeCharacterTierReward(nextReward)}</>}
      </p>
      <TierSegmentBar
        thresholds={ACHIEVEMENT_TIERS}
        claimedTierIndex={claimedTierIndex}
        reachedTierIndex={reachedTierIndex}
        describeReward={(tierIndex) => describeCharacterTierReward(CHARACTER_TIER_REWARDS[tierIndex])}
        formatThreshold={(threshold) => `${threshold.toLocaleString()} kills`}
        busy={busy}
        onClaim={() => claimCharacterTier(characterId, monsterId)}
      />
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

  const kills = entry?.kills ?? 0
  const claimedTierIndex = entry?.claimedTierIndex ?? 0
  const reachedTierIndex = tierIndexReached(kills, ACCOUNT_TIER_THRESHOLDS)
  const claimable = reachedTierIndex > claimedTierIndex
  const maxed = claimedTierIndex >= ACCOUNT_TIER_THRESHOLDS.length
  const monsterZoneId = zoneIdForMonster(monsterId)

  return (
    <MonsterCard badgeCount={claimable ? 1 : 0}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-200">{displayName}</p>
        <p className="text-[11px] text-slate-500">{Math.floor(kills).toLocaleString()} kills (all characters)</p>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {maxed ? (
          <span className="font-medium text-emerald-400">All tiers claimed</span>
        ) : (
          <>Next: {describeAccountTierReward(monsterZoneId ?? undefined, ZONE_ORDER)}</>
        )}
      </p>
      <TierSegmentBar
        thresholds={ACCOUNT_TIER_THRESHOLDS}
        claimedTierIndex={claimedTierIndex}
        reachedTierIndex={reachedTierIndex}
        describeReward={() => describeAccountTierReward(monsterZoneId ?? undefined, ZONE_ORDER)}
        formatThreshold={(threshold) => `${threshold.toLocaleString()} kills`}
        busy={busy || !accountId}
        onClaim={() => claimAccountTier(accountId ?? '', monsterId)}
      />
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

// Zone Tier ladder — the additive per-zone Comet Scroll ladder, separate from
// the per-monster Kill Count ladder above; see achievementData.ts. Replaces
// the old blue/green milestone bar + separate Claim button (2026-08-28
// redesign, requested by the user) with the same full-width TierSegmentBar
// used for the per-monster ladders: each of the 6 segments doubles as the
// zone tier's Claim button once its completion count is reached, server-
// verified via claim_zone_tier_reward rather than trusted from this
// component's own display math.
function ZoneTierSection({ characterId, zoneId }: { characterId: string; zoneId: ZoneId }) {
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const claimedZoneTier = useAchievementsStore((state) => state.zoneClaims[zoneId] ?? 0)
  const busy = useAchievementsStore((state) => state.busy)
  const claimZoneTier = useAchievementsStore((state) => state.claimZoneTier)

  const zoneMonsterKills = ZONES[zoneId].monsterOrder.map((monsterId) => characterKills[monsterId]?.kills ?? 0)
  const { completions, zoneTier: reachedZoneTier } = zoneTierCompletions(zoneMonsterKills)
  const maxed = claimedZoneTier >= ZONE_TIER_COMPLETIONS.length

  return (
    <div className="w-full" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {completions}/{ZONE_TOTAL_TIER_MILESTONES} completions
        </span>
        {maxed ? (
          <span className="font-medium text-emerald-400">All Zone Tiers claimed</span>
        ) : (
          claimedZoneTier > 0 && <span className="text-emerald-400">Zone Tier {claimedZoneTier}</span>
        )}
      </div>
      <TierSegmentBar
        thresholds={ZONE_TIER_COMPLETIONS}
        claimedTierIndex={claimedZoneTier}
        reachedTierIndex={reachedZoneTier}
        describeReward={(tierIndex) => `${ZONE_TIER_COMET_SCROLL_REWARD[tierIndex]} Comet Scroll${ZONE_TIER_COMET_SCROLL_REWARD[tierIndex] === 1 ? '' : 's'}`}
        formatThreshold={(threshold) => `${threshold} completions`}
        busy={busy}
        onClaim={() => claimZoneTier(characterId, zoneId)}
      />
    </div>
  )
}

// Each zone starts collapsed and only shows its monster rows once selected
// — an accordion (one zone open at a time). Also shows a claimable-count
// notification badge next to the zone name when it has any pending claims.
// Two zone cards per row on desktop (2026-08-28, requested by the user) —
// expanding one card grows its grid row's height, pushing the row underneath
// down, same as it always did in a single-column list; its row-mate just
// keeps whatever height its own (shorter) content gives it.
function CollapsibleZoneGroups({
  expandedZoneId,
  onToggleZone,
  renderMonster,
  claimableByZone,
  renderZoneExtra,
  renderZoneTier,
}: {
  expandedZoneId: ZoneId | null
  onToggleZone: (zoneId: ZoneId) => void
  renderMonster: (monsterId: EnemyTypeId, displayName: string) => ReactNode
  claimableByZone?: Partial<Record<ZoneId, number>>
  // Only the Account tab passes this (2026-08-07, confirmed with the user:
  // "display these zones as cards and display the current achieved bonus")
  // — the zone's own Attack/Quality combat-bonus totals, shown right on the
  // collapsed card so they're visible without expanding it. Replaces the
  // old standalone "Combat bonuses by zone" summary block that used to sit
  // above this whole list.
  renderZoneExtra?: (zoneId: ZoneId) => ReactNode
  // Only the Character tab's own Zones passes this — the Zone Tier ladder +
  // its own claim segments (ZoneTierSection), full-width below the title
  // row rather than sharing it, since it renders real <button> elements that
  // can't nest inside the header's own toggle control below (that control
  // was switched from a <button> to a <div role="button"> for exactly this
  // reason). The Fallen Star zone ladder is scoped to one character, so the
  // Account tab doesn't pass this.
  renderZoneTier?: (zoneId: ZoneId) => ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
            <div className="p-4">
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
                className="flex w-full cursor-pointer items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-200">{zone.displayName}</p>
                  <NotificationBadge count={zoneBadgeCount} />
                </div>
                <span className={`text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
              </div>
              {renderZoneTier && <div className="mt-2">{renderZoneTier(zoneId)}</div>}
              {renderZoneExtra && <div className="mt-1">{renderZoneExtra(zoneId)}</div>}
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
    </div>
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
        claimableByZone={claimableByZone}
        renderZoneTier={(zoneId) => <ZoneTierSection characterId={characterId} zoneId={zoneId} />}
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
