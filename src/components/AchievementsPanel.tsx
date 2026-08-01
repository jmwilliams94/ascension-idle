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
  PET_DROP_CHANCE,
  currentAchievementTier,
  nextTierToUnlock,
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

// Shared by CharacterProgress and UnlockRow — both show the same
// character-owned ladder (kills + unlockedTierIndex), just in different
// contexts (pure progress display vs. the row that also has a Buy button).
function characterTierState(kills: number, unlockedTierIndex: number, tierIndex: number): TierVisualState {
  const threshold = ACHIEVEMENT_TIERS[tierIndex]
  if (kills < threshold) return 'locked'
  return tierIndex < unlockedTierIndex ? 'active' : 'partial'
}

function characterTierTooltipLines(tierIndex: number, state: TierVisualState, kills: number): string[] {
  const threshold = ACHIEVEMENT_TIERS[tierIndex]
  const rewardPct = Math.round((ACHIEVEMENT_GOLD_MULTIPLIER[threshold] - 1) * 100)
  const rewardLine = `Reward: +${rewardPct}% gold`
  if (state === 'active') return [rewardLine, 'Active now']
  if (state === 'partial') return [rewardLine, 'Reached — unlock this tier in Unlocks to activate']
  return [rewardLine, `${(threshold - kills).toLocaleString()} kills to go`]
}

// Pure progress display — no unlock button here anymore, see UnlockRow.
function CharacterProgress({ monsterId }: { monsterId: EnemyTypeId }) {
  const characterEntry = useAchievementsStore((state) => state.characterKills[monsterId])
  const kills = characterEntry?.kills ?? 0
  const unlockedTierIndex = characterEntry?.unlockedTierIndex ?? 0

  const tier = currentAchievementTier(kills, unlockedTierIndex)
  const activePct = tier ? Math.round((ACHIEVEMENT_GOLD_MULTIPLIER[tier] - 1) * 100) : 0

  const getState = (tierIndex: number) => characterTierState(kills, unlockedTierIndex, tierIndex)
  const getTooltipLines = (tierIndex: number, state: TierVisualState) => characterTierTooltipLines(tierIndex, state, kills)

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
// maxed (tier 6) monsters simply don't show up on this tab at all. Now shows
// the full 6-tier TierLadderBar (confirmed with the user, 2026-08-01 —
// supersedes an earlier version that only ever showed the single next-tier
// button and a "tier X of 6" text line, with nothing visualizing the other
// 5 tiers at all) — the Buy button still only ever purchases the next tier
// in sequence, but the bar now gives the same full-ladder context every
// other tab already shows.
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

  const getState = (tierIndex: number) => characterTierState(kills, unlockedTierIndex, tierIndex)
  const getTooltipLines = (tierIndex: number, state: TierVisualState) => characterTierTooltipLines(tierIndex, state, kills)

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
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-200">{displayName}</p>
          <p className="text-[11px] text-slate-500">{kills.toLocaleString()} kills</p>
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
      <div className="mt-2">
        <TierLadderBar kills={kills} getState={getState} getTooltipLines={getTooltipLines} />
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
}: {
  expandedZoneId: ZoneId | null
  onToggleZone: (zoneId: ZoneId) => void
  renderMonster: (monsterId: EnemyTypeId, displayName: string) => ReactNode
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
              <p className="text-sm font-medium text-slate-200">{zone.displayName}</p>
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
  zones: 'Kill a monster repeatedly to climb its personal ladder. Hover a tier segment to see its reward. Tap a zone to expand it.',
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
// Unlocks sub-tab moved here from what used to be its own top-level tab
// (unlocking a tier still spends a *character's* own Meteors/DragonBalls —
// see UnlockRow — only where it lives in the UI changed). All three
// zone-grouped sections here collapse per zone independently (their own
// expanded-zone state each), matching the Character tab's Zones behavior.
type AccountSubTab = 'zones' | 'quests' | 'unlocks'

const ACCOUNT_SUB_TAB_DESCRIPTIONS: Record<AccountSubTab, string> = {
  zones:
    'Every character on this account contributes to the same account-wide ladder per monster — its own reward category is still being designed. Tap a zone to expand it.',
  quests: 'Quests aren’t designed yet.',
  unlocks:
    'Spend Meteors/DragonBalls to unlock the next tier on a monster’s personal ladder. Unlocking ahead of your kill count is fine — the reward just won’t be active until you catch up.',
}

function AccountTabContent({ characterId }: { characterId: string }) {
  const [subTab, setSubTab] = useState<AccountSubTab>('zones')
  const [zonesExpandedZoneId, setZonesExpandedZoneId] = useState<ZoneId | null>(null)
  const [unlocksExpandedZoneId, setUnlocksExpandedZoneId] = useState<ZoneId | null>(null)

  const SUB_TABS: { id: AccountSubTab; label: string }[] = [
    { id: 'zones', label: 'Zones' },
    { id: 'quests', label: 'Quests' },
    { id: 'unlocks', label: 'Unlocks' },
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

      {subTab === 'unlocks' && (
        <CollapsibleZoneGroups
          expandedZoneId={unlocksExpandedZoneId}
          onToggleZone={(zoneId) => setUnlocksExpandedZoneId((current) => (current === zoneId ? null : zoneId))}
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
