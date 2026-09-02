import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import InventoryPanel from './InventoryPanel'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId, type ZoneId } from '../game/zones/zoneData'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { resolveCombat, touchCombatLastResolvedAt, claimHuntingSlot } from '../game/combat/resolveCombat'
import { useHuntingTakeoverToastStore } from '../game/combat/useHuntingTakeoverToastStore'
import { getLevelDiffColor } from '../game/combat/combatResolver'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { POTION_TYPES, HP_POTION_ORDER, MP_POTION_ORDER } from '../game/items/potionTypes'
import { useSkillsStore } from '../game/skills/useSkillsStore'
import { SKILL_TYPES } from '../game/skills/skillData'
import EventsCardStack from './EventsCardStack'
import PvpDuelBoard from './pvp/PvpDuelBoard'
import RowCombatPanel from './RowCombatPanel'
import { useRowCombatStore } from '../game/combat/useRowCombatStore'
import { supabase } from '../lib/supabaseClient'
import { useActiveEventEmberColor } from '../game/hud/useEventEmberColor'
import { EventEmberBorder } from '../game/hud/eventEmberBorder'
import MiningModePanel from './MiningModePanel'
import { MINING_PICKAXE_DROP_ZONE } from './PickaxeEquipSlot'
import { useMiningStore } from '../game/mining/useMiningStore'
import { useIdleModeStore } from '../game/mining/useIdleModeStore'
import { useCombatModeStore } from '../game/combat/useCombatModeStore'
import { equipPickaxe } from '../game/mining/pickaxeEquipActions'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { DragDropProvider } from './dragDrop'
import { useFxStore } from '../game/fx/useFxStore'

// Matches getLevelDiffColor's tiers — White is an even match, Green means the
// character comfortably outlevels the monster (reduced EXP), Red/Black mean
// the monster outlevels the character (bonus EXP). "Black" can't literally be
// black text against this UI's dark background, so it uses the darkest shade
// that's still legible instead.
const LEVEL_DIFF_TEXT_CLASS: Record<string, string> = {
  white: 'text-slate-200',
  green: 'text-emerald-400',
  red: 'text-red-400',
  black: 'text-slate-300',
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

// Rare-instance portrait frame tint (2026-09-01) — same amber the RARE
// badge/row-tile border/HP bar already use for isRareInstance, applied via
// the shared .ascension-card-frame.is-tinted var (see index.css) instead of
// a bespoke border color. Replaces the old `super-quality-glow` class,
// which had no matching CSS rule anywhere and rendered as a no-op.
const RARE_PORTRAIT_TINT_STYLE = { '--ascension-tint': '#f59e0b' } as CSSProperties

// How long a floating damage number stays visible after its log entry lands
// (2026-11: slowed from 800ms to 1600ms, requested by the user — must stay
// in sync with the matching motion.div `transition` duration below, since
// entries are dropped from the filtered array the instant they age out of
// this window regardless of whether their own fade animation has finished).
const FLOATING_NUMBER_LIFETIME_MS = 1600

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

// Fighting-game-style "damage trail" (2026-11, requested by the user —
// "like Tekken... you see the brief yellow before it collapses to the new
// HP"). Holds an amber chunk at the pre-hit width for FLASH_HOLD_MS, then
// eases it down to the real value while the real-color bar drops immediately.
//
// A heal (e.g. drinking a potion, 2026-11) runs the same effect in reverse:
// the light flash colour (healFlashColorClass) jumps to the new, higher width
// immediately, and the real-color bar holds at the old width for
// FLASH_HOLD_MS before catching up and filling in underneath it. Same two
// layers, same timings, just which layer leads and which one trails swaps
// with the direction of change.
const FLASH_HOLD_MS = 400
const FLASH_CATCHUP_S = 0.5

// Exported — also reused by ZoneBossCard.tsx for the boss's own HP bar.
export function HpBar({
  current,
  max,
  barColorClass = 'bg-emerald-500',
  healFlashColorClass = 'bg-emerald-300',
}: {
  current: number
  max: number
  barColorClass?: string
  // Light "leading" colour used for the reverse-flash effect on a heal —
  // should read as a paler tint of barColorClass. Defaults to a light green
  // to match the default emerald bar; callers with a different barColorClass
  // (player HP's rose, MP's sky) should pass a matching light variant.
  healFlashColorClass?: string
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0
  const [frontPct, setFrontPct] = useState(pct)
  const [flashPct, setFlashPct] = useState(pct)
  const [flashColorClass, setFlashColorClass] = useState(barColorClass)
  // Last value both layers have settled on — read/written only inside the
  // effect below, so a change landing mid-hold (before the previous
  // catch-up timer fires) correctly compares against the latest pct instead
  // of stacking a second, competing animation.
  const committedPctRef = useRef(pct)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const oldPct = committedPctRef.current
    if (pct === oldPct) return
    committedPctRef.current = pct

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (pct < oldPct) {
      // Damage: real bar drops immediately, amber flash holds at the old
      // (higher) width then eases down to match.
      setFlashColorClass('bg-amber-400')
      setFlashPct(oldPct)
      setFrontPct(pct)
      timeoutRef.current = setTimeout(() => {
        setFlashPct(pct)
        timeoutRef.current = null
      }, FLASH_HOLD_MS)
    } else {
      // Heal: light flash jumps to the new (higher) width immediately, real
      // bar holds at the old width then catches up, filling in behind it.
      setFlashColorClass(healFlashColorClass)
      setFlashPct(pct)
      setFrontPct(oldPct)
      timeoutRef.current = setTimeout(() => {
        setFrontPct(pct)
        timeoutRef.current = null
      }, FLASH_HOLD_MS)
    }
  }, [pct, healFlashColorClass])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-800">
      <motion.div
        className={`absolute inset-y-0 left-0 h-full rounded-full ${flashColorClass}`}
        animate={{ width: `${flashPct}%` }}
        transition={{ duration: FLASH_CATCHUP_S, ease: 'easeOut' }}
      />
      <motion.div
        className={`absolute inset-y-0 left-0 h-full rounded-full ${barColorClass}`}
        animate={{ width: `${frontPct}%` }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      />
    </div>
  )
}

type CombatMode = 'hunting' | 'mining' | 'events' | 'pvp'

const MODE_BUTTON_CLASS =
  'relative flex w-full items-center justify-center rounded-lg px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-[0.08em]'

// CSS letter-spacing adds trailing space AFTER the last character too, not
// just between characters — so a tracking-[0.08em] label inside a centered
// button reads as sitting slightly left-of-center (reported by the user,
// 2026-09-01, on the Hunting button). Wrapping the label and canceling that
// trailing space with an equal negative margin puts the visible glyphs back
// on the true center without touching the letter-spacing itself.
function TrackedLabel({ children }: { children: string }) {
  return <span className="-mr-[0.08em]">{children}</span>
}

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
    <div className="grid grid-cols-4 gap-2">
      <button
        type="button"
        onClick={() => onChange('hunting')}
        className={`${MODE_BUTTON_CLASS} ${mode === 'hunting' ? 'btn-gold-active' : 'btn-gold'}`}
      >
        <TrackedLabel>Hunting</TrackedLabel>
      </button>

      <button
        type="button"
        onClick={() => onChange('mining')}
        className={`${MODE_BUTTON_CLASS} ${mode === 'mining' ? 'btn-gold-active' : 'btn-gold'}`}
      >
        <TrackedLabel>Mining</TrackedLabel>
      </button>

      <EventsModeButton mode={mode} onChange={onChange} />

      <button
        type="button"
        onClick={() => onChange('pvp')}
        className={`${MODE_BUTTON_CLASS} ${mode === 'pvp' ? 'btn-gold-active' : 'btn-gold'}`}
      >
        <TrackedLabel>PvP</TrackedLabel>
      </button>
    </div>
  )
}

// Split out from CombatModeSwitcher so only the Events button subscribes to
// the Zone Boss / Gold Donation stores — Hunting/Mining don't need to
// re-render when those change. Red/green/gold border-ember as the Idling nav
// button (2026-08-16, requested by the user to apply "the same ember rules"
// here) — see useEventEmberColor.ts for the priority rule. EventEmberBorder
// renders as an unclipped sibling of the button in an outer `relative`
// wrapper (2026-08-28, same fix as TabNav's Idling/LuckyLad tabs — see their
// doc comments) rather than the old .btn-ember-safe opt-out, which stripped
// .btn-gold's glass highlight + hover light-sweep while an event was live,
// exactly when this button should look its best. The colored outline ring
// (eventBorderTintStyle) was dropped 2026-08-29, requested by the user —
// double the ember count instead of also drawing attention via an outline.
function EventsModeButton({ mode, onChange }: { mode: CombatMode; onChange: (mode: CombatMode) => void }) {
  const emberColor = useActiveEventEmberColor()

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onChange('events')}
        className={`${MODE_BUTTON_CLASS} ${mode === 'events' ? 'btn-gold-active' : 'btn-gold'}`}
      >
        <TrackedLabel>Events</TrackedLabel>
      </button>
      <EventEmberBorder color={emberColor} count={48} />
    </div>
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
  const currentPlayerMp = useCombatStore((state) => state.currentPlayerMp)
  const maxPlayerMp = useCombatStore((state) => state.maxPlayerMp)
  const equippedSkillId = useSkillsStore((state) => state.equippedSkillId)
  const isRareInstance = useCombatStore((state) => state.isRareInstance)
  const respawnReadyAt = useCombatStore((state) => state.respawnReadyAt)
  const log = useCombatStore((state) => state.log)
  const start = useCombatStore((state) => state.start)
  const stop = useCombatStore((state) => state.stop)
  const clearCombat = useCombatStore((state) => state.clear)

  const characterLevel = useProgressionStore((state) => state.level)
  const characterName = useCharacterRecordStore((state) => state.characterName)
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)

  // Mirrors useCombatStore.runTick's own activeSkill re-derivation (class +
  // level re-validated, never trusts equippedSkillId at face value) — used
  // both to gate the MP bar's visibility below and to pick the outgoing
  // damage color. MP itself is a real pool for every class (BASE_MP=20
  // regardless of Strength/Spirit split), but only shown when there's an
  // actual MP-costing skill equipped and usable, since it's otherwise never
  // spent and would just be confusing clutter.
  const candidateSkill = equippedSkillId ? SKILL_TYPES[equippedSkillId] : null
  const activeSkill =
    candidateSkill && candidateSkill.classId === selectedClassId && characterLevel >= candidateSkill.requiredLevel
      ? candidateSkill
      : null
  // Outgoing damage color (2026-08-26, requested by the user; retargeted
  // 2026-11 alongside the physical-only-without-a-skill damage fix): white
  // for physical, light blue for magic. Used to be a flat per-class proxy
  // (Wuxia always blue) back when the attack formula summed physical+magic
  // unconditionally — now that useCombatStore.runTick actually branches on
  // activeSkill (magic-only while a skill fires, physical-only otherwise),
  // the color follows that same branch exactly instead of guessing off class.
  const dealsMagicDamage = activeSkill !== null
  const outgoingDamageColorClass = dealsMagicDamage ? 'text-sky-300' : 'text-white'

  const potionStacks = usePotionStore((state) => state.stacks)
  const handleUsePotion = usePotionStore((state) => state.usePotion)

  // Hunting (today's existing view) / Mining (coming-soon placeholder) /
  // Events (Zone Boss) — an in-page sub-mode, not a top-level TabId (see
  // CombatModeSwitcher above). Lifted into useCombatModeStore (2026-08-29)
  // so KillRewardToast can gate on it without prop-drilling.
  const mode = useCombatModeStore((state) => state.mode)
  const setMode = useCombatModeStore((state) => state.setMode)

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

  // Enemy portrait's own unclipped wrapper (see the mobile/desktop portrait
  // blocks below) — only one is ever visibly sized at a time (the other is
  // `display: none` behind the lg breakpoint), so the Thunder-strike effect
  // below picks whichever one currently has real dimensions.
  const enemyPortraitMobileRef = useRef<HTMLDivElement>(null)
  const enemyPortraitDesktopRef = useRef<HTMLDivElement>(null)
  // Only ever advanced from inside the effect below, never read during
  // render — tracks how far into `log` the Thunder-lightning trigger has
  // already looked, so re-equipping Thunder mid-fight can't replay a burst
  // of lightning for physical hits that landed before it was ever equipped.
  const lastThunderLogTimestampRef = useRef(0)

  // Lightning FX (2026-11, requested by the user) — fires once per new
  // 'damage'/'miss' log entry while Thunder is the active skill (Thunder is
  // Wuxia's only skill, so `dealsMagicDamage` here means exactly "a Wuxia
  // just attacked with Thunder," see its own comment above). Confined to the
  // enemy portrait's own bounding rect via FxEffectOptions.clip (FxLayer.tsx)
  // rather than the effect's usual full-screen span, per the user's request
  // that it stay "inside the enemy container (the one with the image)."
  useEffect(() => {
    const newEntries = log.filter(
      (entry) => (entry.kind === 'damage' || entry.kind === 'miss') && entry.timestamp > lastThunderLogTimestampRef.current,
    )
    if (newEntries.length === 0) {
      return
    }
    lastThunderLogTimestampRef.current = newEntries[newEntries.length - 1].timestamp
    if (!dealsMagicDamage) {
      return
    }
    const mobileRect = enemyPortraitMobileRef.current?.getBoundingClientRect()
    const desktopRect = enemyPortraitDesktopRef.current?.getBoundingClientRect()
    const rect = mobileRect && mobileRect.width > 0 ? mobileRect : desktopRect
    if (!rect || rect.width === 0 || rect.height === 0) {
      return
    }
    for (let i = 0; i < newEntries.length; i += 1) {
      useFxStore.getState().trigger('lightning', {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      })
    }
  }, [log, dealsMagicDamage])

  const activeType = monsterTypeId ? ENEMY_TYPES[monsterTypeId] : null
  const currentZone = ZONES[currentZoneId]
  // Respawn gap (see useCombatStore's RESPAWN_GAP_MS) — `now` already ticks
  // every 200ms for the floating-number lifetime check above, reused here
  // rather than a second timer.
  const respawnSecondsLeft = respawnReadyAt > 0 ? Math.max(0, Math.ceil((respawnReadyAt - now) / 1000)) : 0
  const isRespawning = respawnSecondsLeft > 0

  // "Best available" HP/Mana potion (confirmed with the user, 2026-07-31 for
  // HP; Mana quick-use added alongside the MP bar itself) — the highest-tier
  // owned stack with any left, so the strongest potion is always the one
  // surfaced here rather than whichever happens to sit first in Inventory.
  let bestHpPotionStack: (typeof potionStacks)[number] | null = null
  for (let i = HP_POTION_ORDER.length - 1; i >= 0; i -= 1) {
    const found = potionStacks.find((stack) => stack.potionType === HP_POTION_ORDER[i] && stack.count > 0)
    if (found) {
      bestHpPotionStack = found
      break
    }
  }
  let bestMpPotionStack: (typeof potionStacks)[number] | null = null
  for (let i = MP_POTION_ORDER.length - 1; i >= 0; i -= 1) {
    const found = potionStacks.find((stack) => stack.potionType === MP_POTION_ORDER[i] && stack.count > 0)
    if (found) {
      bestMpPotionStack = found
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
    // Mining's own trailing window (a separate clock, mining_last_resolved_at
    // — unaffected by the combat-clock reset below, order between the two
    // doesn't matter).
    if (useMiningStore.getState().isMining) {
      useMiningStore.getState().stop()
    }
    // Give the server an honest spawn timestamp for whatever's about to
    // start (v1.123.3, per-instance sync follow-up, reported by the user —
    // kill/respawn moments visually reverting). resolve-combat's own
    // walkCombat stamps a freshly-spawned instance's spawnedAt from
    // combat_last_resolved_at — without resetting that clock here, EVERY
    // monster switch (not just the Mining->Hunting one this used to be
    // scoped to) left it pointed at whenever the *previous* monster last
    // resolved, backdating the new instance's timestamp and making
    // useCombatStore's own anti-regression ordering check (syncMonsterInstance)
    // wrongly treat the server's very first honest-looking confirmation as
    // stale. resolveCombat() first (closes out whatever the previous monster
    // earned up to this exact moment) THEN touchCombatLastResolvedAt —
    // in that order, via .then, not concurrently — so resetting the clock
    // can never erase an unresolved trailing window. Safe against
    // CombatEngine.tsx's own "resolve on switch" trigger firing independently
    // around the same time — both go through serializeByKey, which already
    // serializes concurrent resolve calls per character; whichever lands
    // first does the real work, the other is a harmless near-zero-elapsed
    // no-op. Also incidentally fixes two previously-disclosed gaps for free:
    // a fresh character's very first-ever fight, and Stop -> re-Fight on the
    // same monster not resetting the clock — both now go through this same
    // unconditional path, not just a "genuine switch."
    if (characterId) {
      void resolveCombat(characterId, 'live').then(() => touchCombatLastResolvedAt(characterId))
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
          <div className="ascension-card-frame">
            <div
              className="ascension-card-inner relative overflow-hidden bg-cover bg-center p-4"
              style={currentZone.backgroundUrl ? { backgroundImage: `url(${currentZone.backgroundUrl})` } : undefined}
            >
              {currentZone.backgroundUrl && <div className="absolute inset-0 bg-slate-950/70" />}
              <div className="relative">
                <div className="flex items-center gap-4">
                <div className="relative h-32 w-32 shrink-0" ref={enemyPortraitMobileRef}>
                  <div
                    className={`relative h-full w-full ascension-card-frame ${isRareInstance ? 'is-tinted' : ''}`}
                    style={isRareInstance ? RARE_PORTRAIT_TINT_STYLE : undefined}
                  >
                    <div className="ascension-card-inner relative h-full w-full overflow-hidden">
                      {activeType.portraitUrl ? (
                        <img
                          key={monsterInstanceKey}
                          src={activeType.portraitUrl}
                          alt={activeType.displayName}
                          className={`h-full w-full object-contain p-[15%] transition-opacity ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                        />
                      ) : (
                        <div
                          key={monsterInstanceKey}
                          className={`h-full w-full transition-opacity ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                          style={{ backgroundColor: hexColor(activeType.color) }}
                        />
                      )}
                      {isRespawning && <DeadOverlay seconds={respawnSecondsLeft} />}
                    </div>
                  </div>
                  {/* Rendered as a sibling of the clipped .ascension-card-frame
                      portrait, not a child of it (2026-11) — that class's own
                      chamfer clip-path (see index.css) clips its children too,
                      which was cutting these numbers off at the corners once
                      they were centered/enlarged. z-20 keeps them above
                      RowCombatPanel/the Resume button stacked below. */}
                  <AnimatePresence>
                    {floatingNumbers.map((entry) => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 1, y: 0 }}
                        animate={{ opacity: 0, y: -20 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.6, ease: 'easeOut' }}
                        className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center font-heading font-bold ${
                          entry.kind === 'miss' ? 'text-slate-300' : outgoingDamageColorClass
                        }`}
                        // Nicer-looking damage numbers (2026-08-26, requested by
                        // the user): the game's own Cinzel `.font-heading` font
                        // instead of the default sans-serif. Centered in the
                        // portrait and enlarged again (2026-11, requested by the
                        // user) via inline style so it reliably wins over the
                        // class's own font-size, plus a drop shadow so white/
                        // light-blue text still pops against light monster art.
                        style={{ fontSize: '2.25rem', textShadow: '0 2px 6px rgba(0,0,0,0.9)' }}
                      >
                        {entry.kind === 'miss' ? 'Miss' : `-${entry.amount}`}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${LEVEL_DIFF_TEXT_CLASS[getLevelDiffColor(characterLevel, activeType.level)]}`}
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
                  >
                    {activeType.displayName}
                    {isRareInstance && <span className="ml-2 text-xs font-bold text-amber-300">RARE</span>}
                  </p>
                  <p className="mt-1 text-xs text-slate-300" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>
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
          </div>
        )}

        {mode === 'events' && <EventsCardStack characterId={characterId} />}

        {mode === 'pvp' && characterId && <PvpDuelBoard characterId={characterId} />}

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
              <p className="text-xs text-slate-300">
                {currentPlayerHp} / {maxPlayerHp} HP
              </p>
              <div className="mt-1">
                <HpBar current={currentPlayerHp} max={maxPlayerHp} barColorClass="bg-rose-500" healFlashColorClass="bg-rose-300" />
              </div>
              <AnimatePresence>
                {playerFloatingNumbers.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -16 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.6, ease: 'easeOut' }}
                    className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center font-heading text-lg font-bold ${
                      entry.kind === 'dodge' ? 'text-slate-300' : 'text-rose-300'
                    }`}
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
                  >
                    {entry.kind === 'dodge' ? 'Miss' : `-${entry.amount}`}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* MP bar (2026-11) — MP was already a real, drained resource for
                Wuxia's Thunder skill (see useCombatStore.runTick's 'no-mana'
                gate) but had no visible bar anywhere, so a Wuxia player had no
                warning before Thunder started silently failing. Gated on
                activeSkill so classes with nothing that spends MP don't show
                an irrelevant bar. */}
            {activeSkill && (
              <div className="relative mt-2">
                <p className="text-xs text-slate-300">
                  {/* currentPlayerMp is a real (non-integer) numeric value as of
                  v1.125.35 — resolve-combat now tracks MP spend continuously
                  instead of flooring it to whole casts per resolve call (see
                  that fix's own comment). Floored here for display only; the
                  underlying state stays at full precision for the mpCost
                  gating check below and for resolve-combat's own math. */}
                  {Math.floor(currentPlayerMp)} / {maxPlayerMp} MP
                </p>
                <div className="mt-1">
                  <HpBar current={currentPlayerMp} max={maxPlayerMp} barColorClass="bg-sky-500" healFlashColorClass="bg-sky-300" />
                </div>
              </div>
            )}

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

            {activeSkill && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
                {bestMpPotionStack ? (
                  <>
                    <span className="flex min-w-0 items-center gap-2 text-slate-200">
                      <span className="shrink-0 text-base">💧</span>
                      <span className="truncate">
                        {POTION_TYPES[bestMpPotionStack.potionType].displayName} ({bestMpPotionStack.count})
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={maxPlayerMp > 0 && currentPlayerMp >= maxPlayerMp}
                      onClick={() => void handleUsePotion(bestMpPotionStack!.id)}
                      className="shrink-0 rounded border border-sky-500 bg-sky-500/10 px-3 py-1.5 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
                    >
                      {maxPlayerMp > 0 && currentPlayerMp >= maxPlayerMp ? 'MP full' : 'Use'}
                    </button>
                  </>
                ) : (
                  <span className="text-slate-600">No Mana potions — visit the Shop</span>
                )}
              </div>
            )}
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
        ) : mode === 'pvp' && characterId ? (
          <PvpDuelBoard characterId={characterId} />
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
              <p className="text-xs text-slate-300">
                {currentPlayerHp} / {maxPlayerHp} HP
              </p>
              <div className="mt-1">
                <HpBar current={currentPlayerHp} max={maxPlayerHp} barColorClass="bg-rose-500" healFlashColorClass="bg-rose-300" />
              </div>
              <AnimatePresence>
                {playerFloatingNumbers.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -16 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.6, ease: 'easeOut' }}
                    className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center font-heading text-lg font-bold ${
                      entry.kind === 'dodge' ? 'text-slate-300' : 'text-rose-300'
                    }`}
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
                  >
                    {entry.kind === 'dodge' ? 'Miss' : `-${entry.amount}`}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {activeSkill && (
              <div className="relative mt-2">
                <p className="text-xs text-slate-300">
                  {/* currentPlayerMp is a real (non-integer) numeric value as of
                  v1.125.35 — resolve-combat now tracks MP spend continuously
                  instead of flooring it to whole casts per resolve call (see
                  that fix's own comment). Floored here for display only; the
                  underlying state stays at full precision for the mpCost
                  gating check below and for resolve-combat's own math. */}
                  {Math.floor(currentPlayerMp)} / {maxPlayerMp} MP
                </p>
                <div className="mt-1">
                  <HpBar current={currentPlayerMp} max={maxPlayerMp} barColorClass="bg-sky-500" healFlashColorClass="bg-sky-300" />
                </div>
              </div>
            )}

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

            {activeSkill && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
                {bestMpPotionStack ? (
                  <>
                    <span className="flex min-w-0 items-center gap-2 text-slate-200">
                      <span className="shrink-0 text-base">💧</span>
                      <span className="truncate">
                        {POTION_TYPES[bestMpPotionStack.potionType].displayName} ({bestMpPotionStack.count})
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={maxPlayerMp > 0 && currentPlayerMp >= maxPlayerMp}
                      onClick={() => void handleUsePotion(bestMpPotionStack!.id)}
                      className="shrink-0 rounded border border-sky-500 bg-sky-500/10 px-2 py-1 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
                    >
                      {maxPlayerMp > 0 && currentPlayerMp >= maxPlayerMp ? 'MP full' : 'Use'}
                    </button>
                  </>
                ) : (
                  <span className="text-slate-600">No Mana potions — visit the Shop</span>
                )}
              </div>
            )}
          </AscensionCard>
        )}

        {mode === 'hunting' && activeType && (
          <div className="ascension-card-frame">
            <div
              className="ascension-card-inner relative overflow-hidden bg-cover bg-center p-4"
              style={currentZone.backgroundUrl ? { backgroundImage: `url(${currentZone.backgroundUrl})` } : undefined}
            >
              {currentZone.backgroundUrl && <div className="absolute inset-0 bg-slate-950/70" />}
              <div className="relative">
                <div className="flex items-center gap-4">
                <div className="relative h-40 w-40 shrink-0" ref={enemyPortraitDesktopRef}>
                  <div
                    className={`relative h-full w-full ascension-card-frame ${isRareInstance ? 'is-tinted' : ''}`}
                    style={isRareInstance ? RARE_PORTRAIT_TINT_STYLE : undefined}
                  >
                    <div className="ascension-card-inner relative h-full w-full overflow-hidden">
                      {activeType.portraitUrl ? (
                        <img
                          key={monsterInstanceKey}
                          src={activeType.portraitUrl}
                          alt={activeType.displayName}
                          className={`h-full w-full object-contain p-[15%] transition-opacity ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                        />
                      ) : (
                        <div
                          key={monsterInstanceKey}
                          className={`h-full w-full transition-opacity ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                          style={{ backgroundColor: hexColor(activeType.color) }}
                        />
                      )}
                      {isRespawning && <DeadOverlay seconds={respawnSecondsLeft} />}
                    </div>
                  </div>
                  {/* See the mobile portrait block above for why this is a
                      sibling of the clipped .ascension-card-frame, not a child. */}
                  <AnimatePresence>
                    {floatingNumbers.map((entry) => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 1, y: 0 }}
                        animate={{ opacity: 0, y: -20 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.6, ease: 'easeOut' }}
                        className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center font-heading font-bold ${
                          entry.kind === 'miss' ? 'text-slate-300' : outgoingDamageColorClass
                        }`}
                        style={{ fontSize: '2.5rem', textShadow: '0 2px 6px rgba(0,0,0,0.9)' }}
                      >
                        {entry.kind === 'miss' ? 'Miss' : `-${entry.amount}`}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${LEVEL_DIFF_TEXT_CLASS[getLevelDiffColor(characterLevel, activeType.level)]}`}
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
                  >
                    {activeType.displayName}
                    {isRareInstance && <span className="ml-2 text-xs font-bold text-amber-300">RARE</span>}
                  </p>
                  <p className="mt-1 text-xs text-slate-300" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>
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
