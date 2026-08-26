import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import InventoryPanel from './InventoryPanel'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId, type ZoneId } from '../game/zones/zoneData'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { touchCombatLastResolvedAt, claimHuntingSlot } from '../game/combat/resolveCombat'
import { useHuntingTakeoverToastStore } from '../game/combat/useHuntingTakeoverToastStore'
import { getLevelDiffColor } from '../game/combat/combatResolver'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { POTION_TYPES, HP_POTION_ORDER } from '../game/items/potionTypes'
import EventsCardStack from './EventsCardStack'
import RowCombatPanel from './RowCombatPanel'
import { useRowCombatStore } from '../game/combat/useRowCombatStore'
import { supabase } from '../lib/supabaseClient'
import { useActiveEventEmberColor } from '../game/hud/useEventEmberColor'
import { EventEmberBorder } from '../game/hud/eventEmberBorder'
import { eventBorderTintStyle } from '../game/hud/eventEmberBorderData'
import MiningModePanel from './MiningModePanel'
import { MINING_PICKAXE_DROP_ZONE } from './PickaxeEquipSlot'
import { useMiningStore } from '../game/mining/useMiningStore'
import { useIdleModeStore } from '../game/mining/useIdleModeStore'
import { equipPickaxe } from '../game/mining/pickaxeEquipActions'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { DragDropProvider } from './dragDrop'

// Matches getLevelDiffColor's tiers — White is an even match, Green means the
// character comfortably outlevels the monster (reduced EXP), Red/Black mean
// the monster outlevels the character (bonus EXP). "Black" can't literally be
// black text against this UI's dark background, so it uses the darkest shade
// that's still legible instead.
const LEVEL_DIFF_TEXT_CLASS: Record<string, string> = {
  white: 'text-slate-200',
  green: 'text-emerald-400',
  red: 'text-red-400',
  black: 'text-slate-500',
}

// Same White/Green/Red/Black convention, extended to the Zone/Monster picker
// dropdowns (2026-07-31, per the user's request) so a player can judge a
// zone or monster's fit before committing to Fight, not just after. <option>
// elements don't reliably respect Tailwind's generated utility classes across
// browsers the way a normal element does, so this is a plain inline hex map
// instead — same colors as LEVEL_DIFF_TEXT_CLASS, just usable via `style`.
const LEVEL_DIFF_HEX_COLOR: Record<string, string> = {
  white: '#e2e8f0',
  green: '#34d399',
  red: '#f87171',
  black: '#64748b',
}

// A zone spans a range of monster levels rather than having one level of its
// own — shown as "Lv min-max" in the picker, colored using the midpoint's
// level-diff (a reasonable "is this zone roughly where I'm at" signal, not
// meant to be exact for every monster inside it).
function zoneLevelRange(zone: { monsterOrder: EnemyTypeId[] }): { min: number; max: number; mid: number } | null {
  if (zone.monsterOrder.length === 0) {
    return null
  }
  const levels = zone.monsterOrder.map((id) => ENEMY_TYPES[id].level)
  const min = Math.min(...levels)
  const max = Math.max(...levels)
  return { min, max, mid: Math.round((min + max) / 2) }
}

// Enemy colors are stored as 0xRRGGBB numbers (a Phaser-era convention, kept as-is
// since nothing else about EnemyTypeDef needed to change) — this is the one spot
// that converts to a CSS hex string for the placeholder portrait swatch.
export function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

// How long a floating damage number stays visible after its log entry lands.
const FLOATING_NUMBER_LIFETIME_MS = 800

// Row Combat: clear every row slot whenever the player switches which
// enemy they're fighting (2026-08-17, requested by the user) — otherwise
// Row Combat keeps fighting whatever monster type was locked in at each
// slot's own toggle-on time even after the player has moved on to a
// different primary target, which read as inconsistent. Optimistic local
// clear first (RowCombatPanel updates immediately), RPC persists it
// server-side — fire-and-forget, doesn't block switching targets.
function clearRowSlotsForCharacter(characterId: string) {
  useRowCombatStore.getState().applyServerSlots([])
  void supabase.rpc('clear_row_slots', { p_character_id: characterId }).then(({ error }) => {
    if (error) console.error('clear_row_slots failed', error)
  })
}

// Overlaid on top of the monster portrait during useCombatStore's respawn
// gap (see RESPAWN_GAP_MS) — deliberately layered over the SAME portrait
// element rather than swapping it out for a different block (reported by
// the user, 2026-08-17: swapping to a differently-shaped placeholder made
// the whole card visibly resize/reflow every time a kill happened). The
// portrait itself stays mounted the whole time (see the `opacity-30
// grayscale` classes at both call sites below) — this just adds the "Dead"
// label on top of it.
// `compact` (reused by RowCombatPanel.tsx's much smaller row tiles,
// 2026-08-17) shrinks the text — the default sizing was tuned for this
// page's own large (128-160px) portrait and would overflow a ~50-70px tile.
export function DeadOverlay({
  seconds,
  compact = false,
  label = 'Dead',
}: {
  seconds: number
  compact?: boolean
  // MiningModePanel.tsx passes 'Depleted' — a mining node isn't a creature,
  // "Dead" reads wrong for it. Every other caller (the monster/row-combat
  // respawn gap) keeps the original default.
  label?: string
}) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-slate-950/40 ${compact ? 'rounded-lg' : 'rounded-2xl'}`}
    >
      <span className={`font-bold text-slate-100 ${compact ? 'text-[11px]' : 'text-lg'}`}>{seconds}s</span>
      <span className={`font-bold uppercase tracking-wide text-slate-300 ${compact ? 'text-[8px]' : 'text-xs'}`}>{label}</span>
    </div>
  )
}

// Exported — also reused by WorldBossCard.tsx for the boss's own HP bar.
export function HpBar({ current, max, barColorClass = 'bg-emerald-500' }: { current: number; max: number; barColorClass?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0

  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
      <motion.div
        className={`h-full rounded-full ${barColorClass}`}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 140, damping: 22 }}
      />
    </div>
  )
}

type CombatMode = 'hunting' | 'mining' | 'events'

const MODE_BUTTON_CLASS = 'relative w-full rounded-lg px-3 py-1.5 text-xs font-medium'

// In-page sub-mode switcher (2026-08-26) — same "sub-navigation inside one
// top-level tab" convention MarketplacePanel's Browse/My Listings/Mail and
// ShopPanel's Weapons/Armor/Potions already use. Buttons use the same
// .btn-gold/.btn-gold-active treatment as the top-level nav (2026-08-16,
// supersedes the earlier bespoke amber-pill/ascension-chip look) — .btn-gold
// for idle, .btn-gold-active in place of it for whichever mode is selected.
// Mining (2026-08-22) — a second idle-combat mode, mutually exclusive with
// Hunting (see MiningModePanel.tsx's stopHuntingIfActive/CombatPage's own
// handleFight).
function CombatModeSwitcher({ mode, onChange }: { mode: CombatMode; onChange: (mode: CombatMode) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={() => onChange('hunting')}
        className={`${MODE_BUTTON_CLASS} ${mode === 'hunting' ? 'btn-gold-active' : 'btn-gold'}`}
      >
        Hunting
      </button>

      <button
        type="button"
        onClick={() => onChange('mining')}
        className={`${MODE_BUTTON_CLASS} ${mode === 'mining' ? 'btn-gold-active' : 'btn-gold'}`}
      >
        Mining
      </button>

      <EventsModeButton mode={mode} onChange={onChange} />
    </div>
  )
}

// Split out from CombatModeSwitcher so only the Events button subscribes to
// the World Boss / Gold Donation stores — Hunting/Mining don't need to
// re-render when those change. Same red/green/gold border-ember + outline
// tint as the Idling nav button (2026-08-16, requested by the user to apply
// "the same ember rules" here) — see useEventEmberColor.ts for the priority
// rule.
function EventsModeButton({ mode, onChange }: { mode: CombatMode; onChange: (mode: CombatMode) => void }) {
  const emberColor = useActiveEventEmberColor()

  return (
    <button
      type="button"
      onClick={() => onChange('events')}
      className={`${MODE_BUTTON_CLASS} ${mode === 'events' ? 'btn-gold-active' : 'btn-gold'}`}
      style={eventBorderTintStyle(emberColor)}
    >
      Events
      <EventEmberBorder color={emberColor} />
    </button>
  )
}

export default function CombatPage() {
  const currentZoneId = useZoneStore((state) => state.currentZoneId)
  const setCurrentZoneId = useZoneStore((state) => state.setCurrentZoneId)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const setSelectedMonsterId = useZoneStore((state) => state.setSelectedMonsterId)

  const isFighting = useCombatStore((state) => state.isFighting)
  const monsterTypeId = useCombatStore((state) => state.monsterTypeId)
  const monsterInstanceKey = useCombatStore((state) => state.monsterInstanceKey)
  const currentHp = useCombatStore((state) => state.currentHp)
  const maxHp = useCombatStore((state) => state.maxHp)
  const currentPlayerHp = useCombatStore((state) => state.currentPlayerHp)
  const maxPlayerHp = useCombatStore((state) => state.maxPlayerHp)
  const isRareInstance = useCombatStore((state) => state.isRareInstance)
  const respawnReadyAt = useCombatStore((state) => state.respawnReadyAt)
  const log = useCombatStore((state) => state.log)
  const start = useCombatStore((state) => state.start)
  const stop = useCombatStore((state) => state.stop)
  const clearCombat = useCombatStore((state) => state.clear)

  const characterLevel = useProgressionStore((state) => state.level)
  const characterName = useCharacterRecordStore((state) => state.characterName)
  const characterId = useActiveCharacterStore((state) => state.characterId)
  // Outgoing damage color (2026-08-26, requested by the user): white for
  // physical, light blue for magic. Damage is one combined attackMidpoint
  // number (physicalAttack + magicAttack summed, see combatResolver.ts), not
  // separately tagged per hit — but per that same file's own comment, every
  // class so far only ever puts starting attribute points into one of
  // Strength or Spirit, so exactly one of the two is ever nonzero in
  // practice. Wuxia is the sole Spirit/magic-attack class today, so class
  // alone is a reliable proxy without needing to thread derived stats
  // through here.
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const dealsMagicDamage = selectedClassId === 'wuxia'
  const outgoingDamageColorClass = dealsMagicDamage ? 'text-sky-300' : 'text-white'

  const potionStacks = usePotionStore((state) => state.stacks)
  const handleUsePotion = usePotionStore((state) => state.usePotion)

  // Hunting (today's existing view) / Mining (coming-soon placeholder) /
  // Events (World Boss) — an in-page sub-mode, not a top-level TabId (see
  // CombatModeSwitcher above).
  const [mode, setMode] = useState<CombatMode>('hunting')

  // Mining tab's drag-and-drop equip slot (2026-10-24, requested by the
  // user) — dragging an Inventory tile onto PickaxeEquipSlot resolves here
  // via InventoryPanel's onTileDrop, the same mechanism Forge's own
  // drag-driven material slots use (see dragDropContext.ts). Only wired up
  // while mode === 'mining' (see the InventoryPanel props below), so tiles
  // aren't needlessly draggable during Hunting.
  const inventoryItems = useInventoryStore((state) => state.items)
  const itemTemplates = useItemTemplatesStore((state) => state.templates)
  const handleMiningTileDrop = (overTarget: string, itemId: string) => {
    if (overTarget !== MINING_PICKAXE_DROP_ZONE || !characterId) return
    const item = inventoryItems.find((entry) => entry.id === itemId)
    const template = item && itemTemplates.find((entry) => entry.id === item.template_id)
    if (!template || template.item_family !== 'pickaxe') return
    void equipPickaxe(characterId, itemId)
  }

  // Mobile-only (see the lg:hidden layout below) — Inventory defaults collapsed
  // there so the action area (monster/player HP, Fight/Stop) is what's visible
  // without scrolling.
  const [inventoryExpanded, setInventoryExpanded] = useState(false)

  // Floating damage numbers are derived from the log itself (recent 'damage'
  // entries, by timestamp) rather than tracked as their own state — avoids
  // synchronously deriving state inside an effect. `now` is only ever read/written
  // from the interval's effect callback (never called directly during render, which
  // React's purity rules disallow) so the numbers actually disappear
  // ~FLOATING_NUMBER_LIFETIME_MS after landing instead of lingering until the next
  // unrelated re-render.
  const [now, setNow] = useState(0)

  useEffect(() => {
    // Only ever set from this timer callback (an external clock), never directly
    // in the effect body itself — the first tick lands ~200ms after mount, which
    // is an acceptable brief gap before floating numbers can appear.
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [])

  // 'miss'/'dodge' entries have no `amount` — rendered as "Miss" text instead
  // of a "-N" number (see the floating-text blocks below).
  const floatingNumbers =
    now === 0
      ? [] // `now` hasn't been initialized by the interval effect yet (very first render) —
        // treat as "nothing recent" rather than matching every entry against a stale `now`.
      : log.filter(
          (entry) => (entry.kind === 'damage' || entry.kind === 'miss') && now - entry.timestamp < FLOATING_NUMBER_LIFETIME_MS,
        )

  const playerFloatingNumbers =
    now === 0
      ? []
      : log.filter(
          (entry) => (entry.kind === 'player-damage' || entry.kind === 'dodge') && now - entry.timestamp < FLOATING_NUMBER_LIFETIME_MS,
        )

  const activeType = monsterTypeId ? ENEMY_TYPES[monsterTypeId] : null
  const currentZone = ZONES[currentZoneId]
  // Respawn gap (see useCombatStore's RESPAWN_GAP_MS) — `now` already ticks
  // every 200ms for the floating-number lifetime check above, reused here
  // rather than a second timer.
  const respawnSecondsLeft = respawnReadyAt > 0 ? Math.max(0, Math.ceil((respawnReadyAt - now) / 1000)) : 0
  const isRespawning = respawnSecondsLeft > 0

  // "Best available" HP potion (confirmed with the user, 2026-07-31) — the
  // highest-tier owned stack with any left, so the strongest potion is
  // always the one surfaced here rather than whichever happens to sit first
  // in Inventory. Mana potions are still skipped here — MP is real now (see
  // src/game/skills/skillData.ts) but only Wuxia's Thunder spends any yet;
  // an equivalent quick-use MP surface is a straightforward follow-up, not
  // done in this first pass. The Inventory tab's own potion detail card
  // already has a working Mana potion Use button.
  let bestHpPotionStack: (typeof potionStacks)[number] | null = null
  for (let i = HP_POTION_ORDER.length - 1; i >= 0; i -= 1) {
    const found = potionStacks.find((stack) => stack.potionType === HP_POTION_ORDER[i] && stack.count > 0)
    if (found) {
      bestHpPotionStack = found
      break
    }
  }
  const dropdownMonsterId = selectedMonsterId ?? currentZone.monsterOrder[0] ?? null

  const handleFight = (typeId: EnemyTypeId) => {
    // Only a genuine switch (not resuming the monster already selected)
    // clears Row Combat — see clearRowSlotsForCharacter's own comment.
    if (typeId !== monsterTypeId && characterId) {
      clearRowSlotsForCharacter(characterId)
    }
    // Hunting and Mining can never both be active (confirmed by the user) —
    // mirrors MiningModePanel's own stopHuntingIfActive. stop() triggers
    // MiningEngine's own subscription-driven final resolve, closing out
    // Mining's own trailing window — but combat_last_resolved_at sits frozen
    // the whole time Mining was active, so without the touch call below,
    // resuming Hunting here would replay that entire Mining session as a
    // Hunting catch-up (bug, reported by the user, fixed 2026-09-30 — see
    // the migration's own comment).
    if (useMiningStore.getState().isMining) {
      useMiningStore.getState().stop()
      if (characterId) {
        void touchCombatLastResolvedAt(characterId)
      }
    }
    // Hunting Slot exclusivity (see resolveCombat.ts's own comment) — claims
    // the account-wide slot for this character, silently displacing whoever
    // held it before.
    if (characterId) {
      void claimHuntingSlot(characterId).then((result) => {
        if (result.ok && result.previous_hunter_name) {
          useHuntingTakeoverToastStore.getState().show(result.previous_hunter_name)
        }
      })
    }
    useIdleModeStore.getState().setLastActiveIdleMode('hunting')
    setSelectedMonsterId(typeId)
    start(typeId)
  }

  const handleToggle = () => {
    if (isFighting) {
      stop()
    } else if (monsterTypeId) {
      handleFight(monsterTypeId)
    }
  }

  const handleSelectZone = (zoneId: ZoneId) => {
    if (ZONES[zoneId].locked || zoneId === currentZoneId) {
      return
    }
    clearCombat()
    if (characterId) clearRowSlotsForCharacter(characterId)
    setCurrentZoneId(zoneId)
  }

  return (
    <DragDropProvider>
      {/* Mobile-only layout (below `lg`) — action area (monster/player HP,
          Fight/Stop, Consumable) prioritized at the top since that's what's
          looked at moment-to-moment; Zone/Monster picker below it (still
          always reachable, just not the first thing on screen); Inventory
          collapsed by default so the initial view is short enough to not
          require scrolling on a phone. No Gold/EXP row here — ExpBar
          (GameShell's persistent top strip, shown above every tab) already
          covers that, so repeating it here would just be more scroll for
          nothing. Desktop's layout (below) is untouched — this is entirely
          separate markup, not a responsive reflow of the same JSX, so
          nothing here can regress the desktop view. */}
      <div className="space-y-3 lg:hidden">
        <CombatModeSwitcher mode={mode} onChange={setMode} />

        {mode === 'mining' && characterId && (
          <div className="space-y-3">
            <MiningModePanel characterId={characterId} />
          </div>
        )}

        {mode === 'hunting' && activeType && (
          <div
            className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 bg-cover bg-center p-4"
            style={currentZone.backgroundUrl ? { backgroundImage: `url(${currentZone.backgroundUrl})` } : undefined}
          >
            {currentZone.backgroundUrl && <div className="absolute inset-0 bg-slate-950/60" />}
            <div className="relative">
              <div className="flex items-center gap-4">
              <div className="relative h-32 w-32 shrink-0">
                {activeType.portraitUrl ? (
                  <img
                    key={monsterInstanceKey}
                    src={activeType.portraitUrl}
                    alt={activeType.displayName}
                    className={`h-32 w-32 rounded-2xl border-2 border-slate-700 object-contain p-[15%] transition-opacity ${isRareInstance ? 'super-quality-glow' : ''} ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                  />
                ) : (
                  <div
                    key={monsterInstanceKey}
                    className={`h-32 w-32 rounded-2xl border-2 border-slate-700 transition-opacity ${isRareInstance ? 'super-quality-glow' : ''} ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                    style={{ backgroundColor: hexColor(activeType.color) }}
                  />
                )}
                {isRespawning && <DeadOverlay seconds={respawnSecondsLeft} />}
                <AnimatePresence>
                  {floatingNumbers.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 1, y: 0 }}
                      animate={{ opacity: 0, y: -32 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 font-heading font-bold ${
                        entry.kind === 'miss' ? 'text-slate-300' : outgoingDamageColorClass
                      }`}
                      // Nicer-looking damage numbers (2026-08-26, requested by
                      // the user): the game's own Cinzel `.font-heading` font
                      // instead of the default sans-serif, ~50% larger than
                      // the prior text-sm (0.875rem * 1.5 = 1.3125rem) via
                      // inline style so it reliably wins over the class's own
                      // font-size (same convention as this page's character-
                      // name label above), plus a drop shadow so white/light-
                      // blue text still pops against light monster art.
                      style={{ fontSize: '1.3125rem', textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
                    >
                      {entry.kind === 'miss' ? 'Miss' : `-${entry.amount}`}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${LEVEL_DIFF_TEXT_CLASS[getLevelDiffColor(characterLevel, activeType.level)]}`}>
                  {activeType.displayName}
                  {isRareInstance && <span className="ml-2 text-xs font-bold text-amber-300">RARE</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {isRespawning ? `Respawning in ${respawnSecondsLeft}s...` : `${currentHp} / ${maxHp} HP`}
                </p>
                <div className="mt-2">
                  <HpBar current={isRespawning ? 0 : currentHp} max={maxHp} />
                </div>
              </div>
              </div>

            {characterId && <RowCombatPanel characterId={characterId} />}

            <Button variant="secondary" onClick={handleToggle} className="mt-4 w-full">
              {isFighting ? 'Stop' : 'Resume'}
            </Button>
            </div>
          </div>
        )}

        {mode === 'events' && <EventsCardStack characterId={characterId} />}

        {mode === 'hunting' && activeType && (
          <AscensionCard>
            {/* Doubled from the shared .text-heading-label 0.7rem base
                (2026-08-14, requested by the user) — inline style, not a
                Tailwind text-size utility, so it reliably wins over the
                class's own font-size regardless of generated CSS order. */}
            <p className="text-heading-label" style={{ fontSize: '1.4rem' }}>
              {characterName}
            </p>
            <div className="relative mt-1">
              <p className="text-xs text-slate-500">
                {currentPlayerHp} / {maxPlayerHp} HP
              </p>
              <div className="mt-1">
                <HpBar current={currentPlayerHp} max={maxPlayerHp} barColorClass="bg-rose-500" />
              </div>
              <AnimatePresence>
                {playerFloatingNumbers.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -20 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className={`pointer-events-none absolute right-0 top-0 text-sm font-bold ${
                      entry.kind === 'dodge' ? 'text-slate-300' : 'text-rose-300'
                    }`}
                  >
                    {entry.kind === 'dodge' ? 'Miss' : `-${entry.amount}`}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
              {bestHpPotionStack ? (
                <>
                  <span className="flex min-w-0 items-center gap-2 text-slate-200">
                    <span className="shrink-0 text-base">🧪</span>
                    <span className="truncate">
                      {POTION_TYPES[bestHpPotionStack.potionType].displayName} ({bestHpPotionStack.count})
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp}
                    onClick={() => void handleUsePotion(bestHpPotionStack!.id)}
                    className="shrink-0 rounded border border-sky-500 bg-sky-500/10 px-3 py-1.5 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
                  >
                    {maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp ? 'HP full' : 'Use'}
                  </button>
                </>
              ) : (
                <span className="text-slate-600">No HP potions — visit the Shop</span>
              )}
            </div>
          </AscensionCard>
        )}

        {mode === 'hunting' && (
        <AscensionCard title="Zone & Monster">
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="text-heading-label min-w-[140px] flex-1">
              Zone
              <Select
                value={currentZoneId}
                onChange={(event) => handleSelectZone(event.target.value as ZoneId)}
                className="mt-1"
              >
                {ZONE_ORDER.map((zoneId) => {
                  const zone = ZONES[zoneId]
                  const range = zoneLevelRange(zone)
                  return (
                    <option
                      key={zoneId}
                      value={zoneId}
                      disabled={zone.locked}
                      style={range ? { color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, range.mid)] } : undefined}
                    >
                      {zone.displayName}
                      {range ? ` (Lv ${range.min}-${range.max})` : ''}
                      {zone.locked ? ' (coming soon)' : ''}
                    </option>
                  )
                })}
              </Select>
            </label>

            <label className="text-heading-label min-w-[140px] flex-1">
              Monster
              <Select
                value={dropdownMonsterId ?? ''}
                disabled={currentZone.monsterOrder.length === 0}
                onChange={(event) => setSelectedMonsterId(event.target.value as EnemyTypeId)}
                className="mt-1"
              >
                {currentZone.monsterOrder.length === 0 ? (
                  <option value="">Coming soon</option>
                ) : (
                  currentZone.monsterOrder.map((typeId) => {
                    const type = ENEMY_TYPES[typeId]
                    return (
                      <option key={typeId} value={typeId} style={{ color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, type.level)] }}>
                        {type.displayName} (Lv {type.level})
                      </option>
                    )
                  })
                )}
              </Select>
            </label>
          </div>

          <Button
            variant="primary"
            disabled={!dropdownMonsterId || (isFighting && monsterTypeId === dropdownMonsterId)}
            onClick={() => dropdownMonsterId && handleFight(dropdownMonsterId)}
            className="mt-3 w-full"
          >
            {isFighting && monsterTypeId === dropdownMonsterId ? 'Fighting' : 'Fight'}
          </Button>
        </AscensionCard>
        )}

        <AscensionCard>
          <button
            type="button"
            onClick={() => setInventoryExpanded((value) => !value)}
            className="flex w-full items-center justify-between text-left"
          >
            <p className="text-sm font-medium text-slate-200">Inventory</p>
            <span className="text-xs text-slate-400">{inventoryExpanded ? 'Hide ▲' : 'Show ▼'}</span>
          </button>

          {inventoryExpanded && (
            <div className="mt-3">
              <InventoryPanel columns={5} equipPopoverEnabled onTileDrop={mode === 'mining' ? handleMiningTileDrop : undefined} />
            </div>
          )}
        </AscensionCard>
      </div>

      {/* Desktop layout (`lg` and up) — unchanged from before this step. */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-2">
      <div className="space-y-4">
        {mode === 'mining' && characterId && <MiningModePanel characterId={characterId} />}

        {mode === 'hunting' ? (
        <AscensionCard title="Zone & Monster">
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="text-heading-label min-w-[160px] flex-1">
              Zone
              <Select
                value={currentZoneId}
                onChange={(event) => handleSelectZone(event.target.value as ZoneId)}
                className="mt-1"
              >
                {ZONE_ORDER.map((zoneId) => {
                  const zone = ZONES[zoneId]
                  const range = zoneLevelRange(zone)
                  return (
                    <option
                      key={zoneId}
                      value={zoneId}
                      disabled={zone.locked}
                      style={range ? { color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, range.mid)] } : undefined}
                    >
                      {zone.displayName}
                      {range ? ` (Lv ${range.min}-${range.max})` : ''}
                      {zone.locked ? ' (coming soon)' : ''}
                    </option>
                  )
                })}
              </Select>
            </label>

            <label className="text-heading-label min-w-[160px] flex-1">
              Monster
              <Select
                value={dropdownMonsterId ?? ''}
                disabled={currentZone.monsterOrder.length === 0}
                onChange={(event) => setSelectedMonsterId(event.target.value as EnemyTypeId)}
                className="mt-1"
              >
                {currentZone.monsterOrder.length === 0 ? (
                  <option value="">Coming soon</option>
                ) : (
                  currentZone.monsterOrder.map((typeId) => {
                    const type = ENEMY_TYPES[typeId]
                    return (
                      <option key={typeId} value={typeId} style={{ color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, type.level)] }}>
                        {type.displayName} (Lv {type.level})
                      </option>
                    )
                  })
                )}
              </Select>
            </label>
          </div>

          <Button
            variant="primary"
            disabled={!dropdownMonsterId || (isFighting && monsterTypeId === dropdownMonsterId)}
            onClick={() => dropdownMonsterId && handleFight(dropdownMonsterId)}
            className="mt-3 w-full"
          >
            {isFighting && monsterTypeId === dropdownMonsterId ? 'Fighting' : 'Fight'}
          </Button>
        </AscensionCard>
        ) : mode === 'events' ? (
          // Explicit mode check (was a bare hunting?A:B ternary, which leaked
          // this into Mining mode too, stacked below MiningModePanel above —
          // fixed while restructuring this branch for the two-card stack).
          <EventsCardStack characterId={characterId} />
        ) : null}

        {mode === 'hunting' && activeType && (
          <AscensionCard>
            {/* Doubled from the shared .text-heading-label 0.7rem base
                (2026-08-14, requested by the user) — inline style, not a
                Tailwind text-size utility, so it reliably wins over the
                class's own font-size regardless of generated CSS order. */}
            <p className="text-heading-label" style={{ fontSize: '1.4rem' }}>
              {characterName}
            </p>
            <div className="relative mt-1">
              <p className="text-xs text-slate-500">
                {currentPlayerHp} / {maxPlayerHp} HP
              </p>
              <div className="mt-1">
                <HpBar current={currentPlayerHp} max={maxPlayerHp} barColorClass="bg-rose-500" />
              </div>
              <AnimatePresence>
                {playerFloatingNumbers.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -20 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className={`pointer-events-none absolute right-0 top-0 text-sm font-bold ${
                      entry.kind === 'dodge' ? 'text-slate-300' : 'text-rose-300'
                    }`}
                  >
                    {entry.kind === 'dodge' ? 'Miss' : `-${entry.amount}`}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Consumable slot (confirmed with the user, 2026-07-31) — surfaces the
                best (highest-tier) owned HP potion right on the Combat page so
                healing mid-fight doesn't require leaving to the Inventory grid. */}
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
              {bestHpPotionStack ? (
                <>
                  <span className="flex min-w-0 items-center gap-2 text-slate-200">
                    <span className="shrink-0 text-base">🧪</span>
                    <span className="truncate">
                      {POTION_TYPES[bestHpPotionStack.potionType].displayName} ({bestHpPotionStack.count})
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp}
                    onClick={() => void handleUsePotion(bestHpPotionStack!.id)}
                    className="shrink-0 rounded border border-sky-500 bg-sky-500/10 px-2 py-1 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
                  >
                    {maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp ? 'HP full' : 'Use'}
                  </button>
                </>
              ) : (
                <span className="text-slate-600">No HP potions — visit the Shop</span>
              )}
            </div>
          </AscensionCard>
        )}

        {mode === 'hunting' && activeType && (
          <div
            className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 bg-cover bg-center p-4"
            style={currentZone.backgroundUrl ? { backgroundImage: `url(${currentZone.backgroundUrl})` } : undefined}
          >
            {currentZone.backgroundUrl && <div className="absolute inset-0 bg-slate-950/60" />}
            <div className="relative">
              <div className="flex items-center gap-4">
              <div className="relative h-40 w-40 shrink-0">
                {activeType.portraitUrl ? (
                  <img
                    key={monsterInstanceKey}
                    src={activeType.portraitUrl}
                    alt={activeType.displayName}
                    className={`h-40 w-40 rounded-2xl border-2 border-slate-700 object-contain p-[15%] transition-opacity ${isRareInstance ? 'super-quality-glow' : ''} ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                  />
                ) : (
                  <div
                    key={monsterInstanceKey}
                    className={`h-40 w-40 rounded-2xl border-2 border-slate-700 transition-opacity ${isRareInstance ? 'super-quality-glow' : ''} ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                    style={{ backgroundColor: hexColor(activeType.color) }}
                  />
                )}
                {isRespawning && <DeadOverlay seconds={respawnSecondsLeft} />}
                <AnimatePresence>
                  {floatingNumbers.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 1, y: 0 }}
                      animate={{ opacity: 0, y: -32 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 font-heading font-bold ${
                        entry.kind === 'miss' ? 'text-slate-300' : outgoingDamageColorClass
                      }`}
                      // Nicer-looking damage numbers (2026-08-26, requested by
                      // the user): the game's own Cinzel `.font-heading` font
                      // instead of the default sans-serif, ~50% larger than
                      // the prior text-sm (0.875rem * 1.5 = 1.3125rem) via
                      // inline style so it reliably wins over the class's own
                      // font-size (same convention as this page's character-
                      // name label above), plus a drop shadow so white/light-
                      // blue text still pops against light monster art.
                      style={{ fontSize: '1.3125rem', textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
                    >
                      {entry.kind === 'miss' ? 'Miss' : `-${entry.amount}`}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <div className="flex-1">
                <p className={`text-sm font-medium ${LEVEL_DIFF_TEXT_CLASS[getLevelDiffColor(characterLevel, activeType.level)]}`}>
                  {activeType.displayName}
                  {isRareInstance && <span className="ml-2 text-xs font-bold text-amber-300">RARE</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {isRespawning ? `Respawning in ${respawnSecondsLeft}s...` : `${currentHp} / ${maxHp} HP`}
                </p>
                <div className="mt-2">
                  <HpBar current={isRespawning ? 0 : currentHp} max={maxHp} />
                </div>
              </div>
              </div>

            {characterId && <RowCombatPanel characterId={characterId} />}

            <Button variant="secondary" onClick={handleToggle} className="mt-4">
              {isFighting ? 'Stop' : 'Resume'}
            </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <CombatModeSwitcher mode={mode} onChange={setMode} />

        {/* Gold/EXP row removed (2026-08-14, requested by the user) —
            redundant with ExpBar in GameShell's persistent top strip, same
            reasoning the mobile layout above already used to skip it. */}
        <AscensionCard>
          <InventoryPanel columns={5} equipPopoverEnabled onTileDrop={mode === 'mining' ? handleMiningTileDrop : undefined} />
        </AscensionCard>
      </div>
      </div>
    </DragDropProvider>
  )
}
