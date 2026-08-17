import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from './ui/Button'
import { HpBar, hexColor, DeadOverlay } from './CombatPage'
import { supabase } from '../lib/supabaseClient'
import { useRowCombatStore, ROW_RESPAWN_MS, type ServerRowSlot } from '../game/combat/useRowCombatStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useAchievementsStore } from '../game/achievements/useAchievementsStore'
import { ENEMY_TYPES } from '../game/zones/zoneData'
import { resolveRowCombat } from '../game/combat/resolveRowCombat'

// Row Combat, Phase 1 — replaces CombatPage.tsx's old MultiTargetSlots
// placeholder (a 4-slot dashed-border scaffold for an unrelated, never-built
// concept). Two rows of 6 independently-toggled slots — see
// useRowCombatStore.ts's own header for the full design writeup. Each slot,
// when toggled on, spawns whatever monster is CURRENTLY SELECTED in the
// normal Zone & Monster picker (useZoneStore.selectedMonsterId) — not a
// fixed roster — so toggling is disabled with an explanatory title when
// nothing's selected.
//
// Placeholder unlock thresholds (tunable) — mirror claim_row_unlock's own
// SQL copy exactly (must stay in sync): Row 1 at character Kill Count tier
// 2 (250 kills on any one monster), Row 2 at tier 4 (1000 kills).
const ROW_REQUIRED_TIER: Record<1 | 2, number> = { 1: 2, 2: 4 }
const ROW_REQUIRED_KILLS: Record<1 | 2, number> = { 1: 250, 2: 1000 }

// Mirrors CombatPage.tsx's own FLOATING_NUMBER_LIFETIME_MS — how long a
// Multi-Shot "-N"/"Miss" number stays visible on a slot tile after landing.
const FLOATING_NUMBER_LIFETIME_MS = 800

function bestClaimedTier(characterKills: Record<string, { claimedTierIndex: number }>): number {
  return Object.values(characterKills).reduce((max, entry) => Math.max(max, entry.claimedTierIndex), 0)
}

// Bug fix (reported by the user, 2026-08-17): both the Multi-Shot cooldown
// label and each slot's "Respawn Ns" text used to compute Date.now() only
// at render time, with nothing forcing a re-render as real time passed —
// Multi-Shot's own countdown relied on an ad-hoc setInterval started
// inside its click handler, which meant a cooldown active from page load
// (or from a previous session) never ticked at all. A shared, persistent
// ticking `now` tied to the component's own mount lifecycle fixes both.
function useTickingNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

function RowUnlockSection({ characterId, row }: { characterId: string; row: 1 | 2 }) {
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const setUnlocked = useRowCombatStore((state) => state.setUnlocked)
  const row1Unlocked = useRowCombatStore((state) => state.row1Unlocked)
  const row2Unlocked = useRowCombatStore((state) => state.row2Unlocked)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reached = bestClaimedTier(characterKills)
  const claimable = reached >= ROW_REQUIRED_TIER[row]

  const handleClaim = async () => {
    setBusy(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('claim_row_unlock', { p_character_id: characterId, p_row: row })
    setBusy(false)
    if (rpcError || !data?.ok) {
      setError(data?.error ?? rpcError?.message ?? 'Failed to unlock.')
      return
    }
    setUnlocked(row === 1 ? true : row1Unlocked, row === 2 ? true : row2Unlocked)
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-slate-800 bg-slate-950/60 p-3 text-center">
      <p className="text-sm font-medium text-slate-300">Row {row} — Locked</p>
      <p className="mt-1 text-xs text-slate-500">
        {claimable ? 'Ready to unlock!' : `Reach Kill Count Tier ${ROW_REQUIRED_TIER[row]} (${ROW_REQUIRED_KILLS[row].toLocaleString()} kills on one monster)`}
      </p>
      <Button variant="primary" disabled={busy || !claimable} onClick={() => void handleClaim()} className="mt-2">
        {claimable ? `Unlock Row ${row}` : 'Locked'}
      </Button>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  )
}

function RowSlotTile({ characterId, slotIndex }: { characterId: string; slotIndex: number }) {
  const slot = useRowCombatStore((state) => state.slots[slotIndex])
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const [busy, setBusy] = useState(false)
  // 200ms — fine enough for the floating-number lifetime filter below, still
  // coarse enough that the "Respawn Ns" ceil-second text doesn't need its own.
  const now = useTickingNow(200)
  const multiShotHits = useRowCombatStore((state) => state.multiShotHits)
  const floatingHits = multiShotHits.filter((h) => h.slotIndex === slotIndex && now - h.timestamp < FLOATING_NUMBER_LIFETIME_MS)

  const isDead = slot.enabled && slot.deadAt !== 0

  const handleClick = async () => {
    if (busy) return
    if (!slot.enabled && !selectedMonsterId) return
    // Can't toggle off mid-respawn (2026-08-17, requested by the user) —
    // otherwise toggling off then immediately back on re-rolls a fresh
    // full-HP spawn instantly, skipping the 10s respawn wait entirely.
    // Mirrored server-side in toggle_row_slot (the real authority; this is
    // just so the button doesn't invite a click the server would reject).
    if (isDead) return
    setBusy(true)
    await resolveRowCombat(characterId)
    const { data, error } = await supabase.rpc('toggle_row_slot', { p_character_id: characterId, p_slot_index: slotIndex })
    if (!error && data?.ok) {
      useRowCombatStore.getState().applyServerSlots(data.row_slots as ServerRowSlot[])
    }
    setBusy(false)
  }

  if (!slot.enabled) {
    return (
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy || !selectedMonsterId}
        title={selectedMonsterId ? 'Spawn the selected monster here' : 'Select a monster first'}
        className="flex aspect-square w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-800 bg-slate-950/60 text-slate-600 transition hover:border-amber-500/60 hover:text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    )
  }

  const type = slot.monsterTypeId ? ENEMY_TYPES[slot.monsterTypeId] : null
  const respawnRemainingMs = isDead ? Math.max(0, ROW_RESPAWN_MS - (now - slot.deadAt)) : 0

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy || isDead}
      title={isDead ? 'Respawning...' : type ? `${type.displayName} — click to disable` : undefined}
      key={slot.monsterInstanceKey}
      className={`relative flex aspect-square w-full flex-col items-center justify-between overflow-hidden rounded-lg border-2 p-1 transition disabled:cursor-not-allowed ${
        slot.isRareInstance ? 'super-quality-glow border-amber-500/60' : 'border-slate-700'
      } bg-slate-900/80 hover:border-amber-500/60`}
    >
      {/* Same dimmed-image + overlay treatment as the primary target's own
          respawn gap (CombatPage.tsx's DeadOverlay) — the portrait stays
          visible (just faded) instead of being replaced by bare text,
          2026-08-17, requested by the user. */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {type?.portraitUrl ? (
          <img
            src={type.portraitUrl}
            alt={type.displayName}
            className={`h-full w-full object-contain transition-opacity ${isDead ? 'opacity-30 grayscale' : ''}`}
          />
        ) : (
          <div
            className={`h-full w-full rounded transition-opacity ${isDead ? 'opacity-30 grayscale' : ''}`}
            style={{ backgroundColor: hexColor(type?.color ?? 0) }}
          />
        )}
      </div>
      <div className="w-full px-0.5 pb-0.5">
        <HpBar current={isDead ? 0 : slot.currentHp} max={slot.maxHp} barColorClass={slot.isRareInstance ? 'bg-amber-400' : 'bg-emerald-500'} />
      </div>
      {isDead && <DeadOverlay seconds={Math.ceil(respawnRemainingMs / 1000)} compact />}
      <AnimatePresence>
        {floatingHits.map((entry) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 0, y: -16 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className={`pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 text-[11px] font-bold ${
              entry.hit ? 'text-amber-300' : 'text-slate-300'
            }`}
          >
            {entry.hit ? `-${entry.damage}` : 'Miss'}
          </motion.div>
        ))}
      </AnimatePresence>
    </button>
  )
}

function RowGrid({ characterId, row }: { characterId: string; row: 1 | 2 }) {
  const startIndex = row === 1 ? 0 : 6
  return (
    // Labeled + top-bordered as its own section (reported by the user,
    // 2026-08-17 — with no heading at all once unlocked, Row 1's tiles read
    // as part of the Multi-Shot button above rather than a distinct row;
    // a bigger gap alone didn't fix that, since there was still no textual
    // anchor telling the two apart).
    <div className="border-t border-slate-800 pt-3">
      <p className="text-heading-label mb-2">Row {row}</p>
      {/* grid-cols-6 (not flex) — six explicit, exactly-equal tracks always
          spanning the full container width, regardless of tile content.
          flex + flex-1 + aspect-square turned out not to reliably grow tiles
          to fill available width (reported by the user, 2026-08-17 — tiles
          rendered near their own content size instead of stretching); a
          grid track's width doesn't depend on content/aspect-ratio the way
          a flex item's does, so each tile (w-full below) just fills its own
          guaranteed 1/6th-width column. */}
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <RowSlotTile key={startIndex + i} characterId={characterId} slotIndex={startIndex + i} />
        ))}
      </div>
    </div>
  )
}

function MultiShotButton({ characterId }: { characterId: string }) {
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const multiShotReadyAt = useRowCombatStore((state) => state.multiShotReadyAt)
  // Requires a living target, not just an enabled slot (2026-08-17, requested
  // by the user) — an enabled slot mid-respawn has nothing to hit yet.
  // Mirrors the server's own aliveTargets check (resolve-row-combat/index.ts),
  // which is the actual authority — this is just so the button doesn't
  // invite a press that the server would reject as a no-op anyway.
  const anyAliveTarget = useRowCombatStore((state) => state.slots.some((s) => s.enabled && s.currentHp > 0))
  const row1Unlocked = useRowCombatStore((state) => state.row1Unlocked)
  const row2Unlocked = useRowCombatStore((state) => state.row2Unlocked)
  const now = useTickingNow(250)

  // Shown (disabled, not hidden) as soon as a Hunter has unlocked either
  // row — hiding it entirely whenever no slot happens to be active made it
  // easy to miss the feature exists at all (reported by the user, 2026-08-17:
  // toggled a slot on/off in quick succession and never spotted the button).
  if (selectedClassId !== 'hunter' || (!row1Unlocked && !row2Unlocked)) return null

  const onCooldown = now < multiShotReadyAt
  const secondsLeft = Math.ceil((multiShotReadyAt - now) / 1000)
  const disabled = onCooldown || !anyAliveTarget

  const handleFire = async () => {
    if (disabled) return
    useRowCombatStore.getState().fireMultiShotOptimistic(Date.now())
    await resolveRowCombat(characterId, { fireMultiShot: true })
  }

  return (
    <Button
      variant="primary"
      disabled={disabled}
      title={!anyAliveTarget ? 'No living target in either row' : undefined}
      onClick={() => void handleFire()}
      className="w-full"
    >
      {onCooldown ? `Multi-Shot (${Math.max(0, secondsLeft)}s)` : 'Multi-Shot'}
    </Button>
  )
}

export default function RowCombatPanel({ characterId }: { characterId: string }) {
  const row1Unlocked = useRowCombatStore((state) => state.row1Unlocked)
  const row2Unlocked = useRowCombatStore((state) => state.row2Unlocked)

  return (
    <div className="mt-3 space-y-4">
      <MultiShotButton characterId={characterId} />
      {row1Unlocked ? <RowGrid characterId={characterId} row={1} /> : <RowUnlockSection characterId={characterId} row={1} />}
      {row2Unlocked ? <RowGrid characterId={characterId} row={2} /> : <RowUnlockSection characterId={characterId} row={2} />}
    </div>
  )
}
