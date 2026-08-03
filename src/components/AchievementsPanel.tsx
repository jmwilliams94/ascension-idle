import { useState, type ReactNode } from 'react'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId, type ZoneId } from '../game/zones/zoneData'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import { SLOT_SIZE_CLASS } from './InventorySlot'
import {
  ACHIEVEMENT_GOLD_MULTIPLIER,
  ACHIEVEMENT_TIERS,
  KILL_COUNT_BONUS_DROP_MULTIPLIER,
  MIN_KILLS_FOR_PRESTIGE,
  PET_DROP_CHANCE,
  ZONE_TOTAL_TIER_MILESTONES,
  currentKillCountTier,
  currentPrestigeTier,
  nextTierToUnlock,
  zoneTierCompletions,
} from '../game/achievements/achievementData'

// Achievements & Pets, Stage 1 (confirmed shape, see CLAUDE.md — added from a
// mobile session). Grouped by zone (reusing ZONE_ORDER/ZONES the same way
// CombatPage's picker does) since a flat 40-row list would be unwieldy.
//
// Three top-level tabs (confirmed with the user, 2026-08-01 — supersedes an
// earlier four-tab version that had a standalone "Unlocks" tab):
//   - {Character name}: this character's own achievements, split into its
//     own Zones/Quests sub-tabs (see PlayerTabContent).
//   - Account: the account-wide ladder, split into Zones/Quests/Unlocks
//     sub-tabs (see AccountTabContent) — Unlocks moved here from its own
//     top-level tab (it still spends a *character's* own Meteors/DragonBalls
//     to unlock a *character* tier, see UnlockRow — only where it lives in
//     the UI changed, not what it does).
//   - Pets: every monster's pet status (obtained/locked).
type AchievementsTab = 'player' | 'account' | 'pets'

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

// One continuous bar spanning the whole ladder, with a small marker dot at
// each tier's boundary — reverted (2026-08-01) back to this shape after the
// proportional-width divided-pill version broke both the visual sense of
// kill progress (the huge later tiers' ranges dwarfed the early ones, so
// early kills barely moved anything visible) and the "mouseover points"
// design the user actually wanted dots for. Every tier still contributes an
// equal 1/6 share of the overall fill regardless of how far apart its kill
// thresholds are (100 to 250 vs. 5000 to 10000) — a linear kill-count scale
// would make that same problem worse, not better. Thicker than the original
// version per the user's follow-up ("just needed to be a bit of a thicker
// bar"). Hovering a dot shows that tier's own reward via the same universal
// ItemTooltip every other tile in this game already uses.
function TierLadderBar({
  kills,
  getState,
  getTooltipLines,
}: {
  kills: number
  getState: (tierIndex: number) => TierVisualState
  getTooltipLines: (tierIndex: number, state: TierVisualState) => string[]
}) {
  let filledSegments = 0
  for (let index = 0; index < ACHIEVEMENT_TIERS.length; index += 1) {
    const threshold = ACHIEVEMENT_TIERS[index]
    const prevThreshold = index === 0 ? 0 : ACHIEVEMENT_TIERS[index - 1]
    filledSegments += Math.max(0, Math.min(1, (kills - prevThreshold) / (threshold - prevThreshold)))
  }
  const overallPct = (filledSegments / ACHIEVEMENT_TIERS.length) * 100

  return (
    <div className="relative py-1.5">
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
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
            <div key={threshold} className="pointer-events-auto absolute -translate-x-1/2" style={{ left: `${leftPct}%` }}>
              <HoverTooltip content={tooltip}>
                <div
                  className={`h-3 w-3 rounded-full border-2 ${state === 'active' ? 'accent-glow' : ''}`}
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

// Two fully independent tracks (confirmed with the user, 2026-08-03 —
// supersedes the earlier single "reached AND unlocked" gated track, see
// achievementData.ts's own note). Kill Count is free and only ever
// active/locked based on kills; Unlock is paid and only ever active/locked
// based on unlockedTierIndex — neither gates the other anymore, so there's
// no more 'partial' state for either (still used by AccountProgress below,
// which is unrelated to this split).
function killCountTierState(kills: number, tierIndex: number): TierVisualState {
  return kills >= ACHIEVEMENT_TIERS[tierIndex] ? 'active' : 'locked'
}

function killCountTierTooltipLines(tierIndex: number, state: TierVisualState, kills: number): string[] {
  const threshold = ACHIEVEMENT_TIERS[tierIndex]
  const rewardPct = Math.round((KILL_COUNT_BONUS_DROP_MULTIPLIER[threshold] - 1) * 100)
  const rewardLine = `Reward: +${rewardPct}% Meteor/DragonBall drop chance`
  return [rewardLine, state === 'active' ? 'Active now' : `${(threshold - kills).toLocaleString()} kills to go`]
}

function unlockTierState(unlockedTierIndex: number, tierIndex: number): TierVisualState {
  return tierIndex < unlockedTierIndex ? 'active' : 'locked'
}

function unlockTierTooltipLines(tierIndex: number, state: TierVisualState): string[] {
  const threshold = ACHIEVEMENT_TIERS[tierIndex]
  const rewardPct = Math.round((ACHIEVEMENT_GOLD_MULTIPLIER[threshold] - 1) * 100)
  const rewardLine = `Reward: +${rewardPct}% gold`
  return [rewardLine, state === 'active' ? 'Active now' : 'Not unlocked yet — see Prestige']
}

// Pure progress display — no buy button here anymore, see UnlockRow. Kill
// Count keeps its full ladder (free, automatic, its own bonus-drop-chance
// reward — see achievementData.ts). Prestige (renamed from "Unlock",
// 2026-08-03, confirmed with the user) drops its own dot-ladder here in
// favor of a single line of text — "Instead of the existing Unlock tier bar
// ... we can change it to just say what Tier it is" — the full ladder still
// exists over in Prestige's own buy row (UnlockRow), where seeing which
// tiers are already bought is actually useful context for a purchase
// decision; here it's just a status readout.
function CharacterProgress({ monsterId }: { monsterId: EnemyTypeId }) {
  const characterEntry = useAchievementsStore((state) => state.characterKills[monsterId])
  const kills = characterEntry?.kills ?? 0
  const unlockedTierIndex = characterEntry?.unlockedTierIndex ?? 0

  const killTier = currentKillCountTier(kills)
  const killPct = killTier ? Math.round((KILL_COUNT_BONUS_DROP_MULTIPLIER[killTier] - 1) * 100) : 0
  const prestigeTier = currentPrestigeTier(unlockedTierIndex)
  const prestigePct = prestigeTier ? Math.round((ACHIEVEMENT_GOLD_MULTIPLIER[prestigeTier] - 1) * 100) : 0

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Kill Count Reward (free) · {kills.toLocaleString()} kills</span>
          <span className={killTier ? 'text-emerald-400' : ''}>
            {killTier ? `+${killPct}% drop chance active` : 'No tier active yet'}
          </span>
        </div>
        <div className="mt-1.5">
          <TierLadderBar
            kills={kills}
            getState={(tierIndex) => killCountTierState(kills, tierIndex)}
            getTooltipLines={(tierIndex, state) => killCountTierTooltipLines(tierIndex, state, kills)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>Current Prestige: Tier {unlockedTierIndex}</span>
        <span className={prestigeTier ? 'text-emerald-400' : ''}>{prestigeTier ? `+${prestigePct}% gold active` : 'No tier active yet'}</span>
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
// maxed (tier 6) monsters simply don't show up on this tab at all. Shows the
// full 6-tier TierLadderBar — the Buy button still only ever purchases the
// next tier in sequence, but the bar gives the same full-ladder context
// every other tab already shows. Renamed "Unlock" -> **Prestige** everywhere
// (2026-08-03, confirmed with the user, wording only — same
// unlocked_tier_index column/RPC). New gate, also confirmed: a monster's
// Kill Count must reach Tier 1 (MIN_KILLS_FOR_PRESTIGE) before Prestige can
// buy its first tier at all — "to proceed to the next Prestige you need to
// complete the 1st round of Kill Count." A one-time requirement (kills only
// go up), so once satisfied it stays satisfied for every later tier too.
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
  const meetsKillGate = kills >= MIN_KILLS_FOR_PRESTIGE

  if (!toUnlock) {
    return null
  }

  const getState = (tierIndex: number) => unlockTierState(unlockedTierIndex, tierIndex)
  const getTooltipLines = (tierIndex: number, state: TierVisualState) => unlockTierTooltipLines(tierIndex, state)

  const handleUnlock = async () => {
    setError(null)
    const result = await unlockNextTier(characterId, monsterId)
    if (!result.ok) {
      setError(
        result.error === 'not_enough_meteors'
          ? "You don't have enough Meteors."
          : result.error === 'not_enough_dragonballs'
            ? "You don't have enough DragonBalls."
            : result.error === 'kill_count_tier_required'
              ? `Reach ${MIN_KILLS_FOR_PRESTIGE.toLocaleString()} kills on this monster first.`
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

  const disabled = busy || !affordable || !meetsKillGate
  const disabledReason = !meetsKillGate
    ? `Reach ${MIN_KILLS_FOR_PRESTIGE.toLocaleString()} kills (Kill Count Tier 1) first`
    : !affordable
      ? `Need ${toUnlock.cost.amount} ${toUnlock.cost.currency === 'meteor' ? 'Meteors' : 'DragonBalls'}`
      : undefined

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-200">{displayName}</p>
          <p className="text-[11px] text-slate-500">{kills.toLocaleString()} kills</p>
        </div>
        <div className="text-right">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleUnlock()}
            title={disabledReason}
            className="rounded-lg border border-purple-600 bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prestige tier {unlockedTierIndex + 1} ({toUnlock.cost.amount} {toUnlock.cost.currency === 'meteor' ? 'Meteors' : 'DragonBalls'})
          </button>
          {disabledReason && !error && <p className="mt-1 text-[11px] text-slate-500">{disabledReason}</p>}
          {error && <p className="mt-1 text-[11px] text-amber-400">{error}</p>}
        </div>
      </div>
      <div className="mt-2">
        {/* Fill is driven by unlockedTierIndex, not raw kills, since this
            ladder is showing paid-Prestige progress specifically — see
            CharacterProgress's own identical trick. */}
        <TierLadderBar
          kills={unlockedTierIndex > 0 ? ACHIEVEMENT_TIERS[unlockedTierIndex - 1] : 0}
          getState={getState}
          getTooltipLines={getTooltipLines}
        />
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

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  )
}

// Zone-level Achievements summary (2026-08-03, confirmed with the user) — a
// compact readout shown on the zone's own collapsed accordion header ("when
// the zone is collapsed maybe it can display its zone rewards"), so its
// status is visible without expanding to see the 5 individual monster rows.
// Purely a display computation off useAchievementsStore's already-loaded
// characterKills (see zoneTierCompletions in achievementData.ts) — the real
// DragonBall grant only ever happens server-side, tracked via
// character_zone_progress, which the client never reads.
function ZoneAchievementSummary({ zoneId }: { zoneId: ZoneId }) {
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const zoneMonsterKills = ZONES[zoneId].monsterOrder.map((monsterId) => characterKills[monsterId]?.kills ?? 0)
  const { completions, zoneTier } = zoneTierCompletions(zoneMonsterKills)

  return (
    <span className="text-[11px] text-slate-500">
      {completions}/{ZONE_TOTAL_TIER_MILESTONES} tiers completed
      {zoneTier > 0 && <span className="ml-1 text-emerald-400">(Zone Tier {zoneTier})</span>}
    </span>
  )
}

// Same per-zone monster data as ZoneGroups, but each zone starts collapsed
// and only shows its monster rows once selected — confirmed with the user
// (2026-08-01), an accordion (one zone open at a time, selecting another
// collapses the previous one) rather than the always-expanded list every
// other tab still uses, since this is the sub-tab most likely to be scrolled
// through repeatedly.
function CollapsibleZoneGroups({
  expandedZoneId,
  onToggleZone,
  renderMonster,
  showZoneSummary,
}: {
  expandedZoneId: ZoneId | null
  onToggleZone: (zoneId: ZoneId) => void
  renderMonster: (monsterId: EnemyTypeId, displayName: string) => ReactNode
  // Only the Character tab's own Zones sub-tab passes this — Account's Zones/
  // Unlocks reuse of this same component shouldn't show a per-zone
  // Achievements summary that's actually scoped to one character.
  showZoneSummary?: boolean
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

        return (
          <div key={zoneId} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80">
            <button type="button" onClick={() => onToggleZone(zoneId)} className="flex w-full items-center justify-between p-4 text-left">
              <div>
                <p className="text-sm font-medium text-slate-200">{zone.displayName}</p>
                {showZoneSummary && (
                  <div className="mt-0.5">
                    <ZoneAchievementSummary zoneId={zoneId} />
                  </div>
                )}
              </div>
              <span className={`text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {expanded && (
              <div className="space-y-2 border-t border-slate-800 p-4 pt-3">
                {rows.map((entry) => (
                  <div key={entry.monsterId}>{entry.node}</div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// The Character top-level tab's own sub-navigation (confirmed with the user,
// 2026-08-01) — Zones/Quests, a page-local sub-tab state (not useTabStore)
// matching the same "sub-navigation inside one top-level tab" pattern
// ShopPanel's own Weapons/Armor/Potions tabs already established. An earlier
// version of this also had a third "Character" sub-tab, dropped after the
// user felt it was redundant (it duplicated the identity of the top-level tab
// it lived inside, which is already named after this character, and had no
// content of its own yet anyway). "Zones" has real content (the per-monster
// kill ladder that used to be this whole top-level tab's only view, now
// collapsible by zone — see CollapsibleZoneGroups); "Quests" (named per the
// user, 2026-08-01 — a brand-new, entirely undesigned concept as of this
// pass) is a placeholder pending design — don't invent content for it.
type PlayerSubTab = 'zones' | 'quests'

const PLAYER_SUB_TAB_DESCRIPTIONS: Record<PlayerSubTab, string> = {
  zones:
    'Kill a monster repeatedly to climb its personal ladder. Hover a tier segment to see its reward. Each zone also tracks its own total across all 5 monsters — shown on the zone header — and pays out its own DragonBall reward at milestones. Tap a zone to expand it.',
  quests: 'Quests aren’t designed yet.',
}

function PlayerTabContent() {
  const [subTab, setSubTab] = useState<PlayerSubTab>('zones')
  const [expandedZoneId, setExpandedZoneId] = useState<ZoneId | null>(null)

  const SUB_TABS: { id: PlayerSubTab; label: string }[] = [
    { id: 'zones', label: 'Zones' },
    { id: 'quests', label: 'Quests' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SUB_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSubTab(item.id)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
              subTab === item.id ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500">{PLAYER_SUB_TAB_DESCRIPTIONS[subTab]}</p>

      {subTab === 'zones' && (
        <CollapsibleZoneGroups
          expandedZoneId={expandedZoneId}
          onToggleZone={(zoneId) => setExpandedZoneId((current) => (current === zoneId ? null : zoneId))}
          showZoneSummary
          renderMonster={(monsterId, displayName) => (
            <MonsterCard displayName={displayName}>
              <CharacterProgress monsterId={monsterId} />
            </MonsterCard>
          )}
        />
      )}

      {subTab === 'quests' && <PlaceholderCard title="Coming soon" description="Quests aren't designed yet." />}
    </div>
  )
}

// Grid-only zone shell for Pets — the one remaining always-expanded (not
// collapsible) zone grouping, since every other zone-grouped view (Character
// Zones, Account Zones, Account Unlocks) now collapses via
// CollapsibleZoneGroups above. Pets doesn't need collapsing the same way —
// its tile grid is compact enough per zone not to need hiding.
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
          <div key={zoneId} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <p className="text-sm font-medium text-slate-200">{zone.displayName}</p>
            <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
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

// The Account top-level tab's own sub-navigation (confirmed with the user,
// 2026-08-01) — mirrors the Character tab's Zones/Quests split, plus a third
// Prestige sub-tab (renamed from "Unlocks," 2026-08-03, confirmed with the
// user, wording only) moved here from what used to be its own top-level tab
// (buying a Prestige tier still spends a *character's* own Meteors/
// DragonBalls, and now also requires that monster's own Kill Count to have
// reached Tier 1 first — see UnlockRow — only where it lives in the UI
// changed). All three zone-grouped sections here collapse per zone
// independently (their own expanded-zone state each), matching the
// Character tab's Zones behavior.
type AccountSubTab = 'zones' | 'quests' | 'prestige'

const ACCOUNT_SUB_TAB_DESCRIPTIONS: Record<AccountSubTab, string> = {
  zones:
    'Every character on this account contributes to the same account-wide ladder per monster — its own reward category is still being designed. Tap a zone to expand it.',
  quests: 'Quests aren’t designed yet.',
  prestige:
    'Spend Meteors/DragonBalls to advance a monster’s Prestige — a paid gold bonus, separate from Kill Count’s own free reward. Reaching Kill Count Tier 1 on a monster is required before its Prestige can advance at all.',
}

function AccountTabContent({ characterId }: { characterId: string }) {
  const [subTab, setSubTab] = useState<AccountSubTab>('zones')
  const [zonesExpandedZoneId, setZonesExpandedZoneId] = useState<ZoneId | null>(null)
  const [prestigeExpandedZoneId, setPrestigeExpandedZoneId] = useState<ZoneId | null>(null)

  const SUB_TABS: { id: AccountSubTab; label: string }[] = [
    { id: 'zones', label: 'Zones' },
    { id: 'quests', label: 'Quests' },
    { id: 'prestige', label: 'Prestige' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SUB_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSubTab(item.id)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
              subTab === item.id ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500">{ACCOUNT_SUB_TAB_DESCRIPTIONS[subTab]}</p>

      {subTab === 'zones' && (
        <CollapsibleZoneGroups
          expandedZoneId={zonesExpandedZoneId}
          onToggleZone={(zoneId) => setZonesExpandedZoneId((current) => (current === zoneId ? null : zoneId))}
          renderMonster={(monsterId, displayName) => (
            <MonsterCard displayName={displayName}>
              <AccountProgress monsterId={monsterId} />
            </MonsterCard>
          )}
        />
      )}

      {subTab === 'quests' && <PlaceholderCard title="Coming soon" description="Quests aren't designed yet." />}

      {subTab === 'prestige' && (
        <CollapsibleZoneGroups
          expandedZoneId={prestigeExpandedZoneId}
          onToggleZone={(zoneId) => setPrestigeExpandedZoneId((current) => (current === zoneId ? null : zoneId))}
          renderMonster={(monsterId, displayName) => <UnlockRow characterId={characterId} monsterId={monsterId} displayName={displayName} />}
        />
      )}
    </div>
  )
}

const TAB_DESCRIPTIONS: Record<AchievementsTab, string> = {
  player: 'This character’s own achievements, organized into sub-tabs below.',
  account: 'Progress shared across every character on this account, organized into sub-tabs below.',
  pets: `Every monster has a 1 in ${(1 / PET_DROP_CHANCE).toLocaleString()} chance per kill to drop its pet — account-wide, one per monster, forever.`,
}

export default function AchievementsPanel({ characterId }: { characterId: string }) {
  const characterName = useCharacterRecordStore((state) => state.characterName)
  const [tab, setTab] = useState<AchievementsTab>('player')

  const TABS: { id: AchievementsTab; label: string }[] = [
    { id: 'player', label: characterName || 'Character' },
    { id: 'account', label: 'Account' },
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

      {tab === 'player' && <PlayerTabContent />}

      {tab === 'account' && <AccountTabContent characterId={characterId} />}

      {tab === 'pets' && <PetZoneGroups renderMonster={(monsterId, displayName) => <PetTile monsterId={monsterId} displayName={displayName} />} />}
    </div>
  )
}
