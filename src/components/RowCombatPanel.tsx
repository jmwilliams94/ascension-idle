import { useState } from 'react'
import { Button } from './ui/Button'
import { HpBar } from './CombatPage'
import { supabase } from '../lib/supabaseClient'
import { useRowCombatStore, ROW_RESPAWN_MS, MULTI_SHOT_COOLDOWN_MS, type ServerRowSlot } from '../game/combat/useRowCombatStore'
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

function bestClaimedTier(characterKills: Record<string, { claimedTierIndex: number }>): number {
  return Object.values(characterKills).reduce((max, entry) => Math.max(max, entry.claimedTierIndex), 0)
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

  const handleClick = async () => {
    if (busy) return
    if (!slot.enabled && !selectedMonsterId) return
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
        className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-slate-800 bg-slate-950/60 text-slate-600 transition hover:border-amber-500/60 hover:text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    )
  }

  const type = slot.monsterTypeId ? ENEMY_TYPES[slot.monsterTypeId] : null
  const isDead = slot.deadAt !== 0
  const respawnRemainingMs = isDead ? Math.max(0, ROW_RESPAWN_MS - (Date.now() - slot.deadAt)) : 0

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      title={type ? `${type.displayName} — click to disable` : undefined}
      key={slot.monsterInstanceKey}
      className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 p-1 transition disabled:cursor-not-allowed ${
        slot.isRareInstance ? 'super-quality-glow border-amber-500/60' : 'border-slate-700'
      } bg-slate-900/80 hover:border-amber-500/60`}
    >
      {isDead ? (
        <span className="text-[10px] text-slate-500">Respawn {Math.ceil(respawnRemainingMs / 1000)}s</span>
      ) : (
        <>
          <span className="w-full truncate px-0.5 text-center text-[10px] text-slate-300">{type?.displayName}</span>
          <div className="w-full px-0.5">
            <HpBar current={slot.currentHp} max={slot.maxHp} barColorClass={slot.isRareInstance ? 'bg-amber-400' : 'bg-emerald-500'} />
          </div>
        </>
      )}
    </button>
  )
}

function RowGrid({ characterId, row }: { characterId: string; row: 1 | 2 }) {
  const startIndex = row === 1 ? 0 : 6
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <RowSlotTile key={startIndex + i} characterId={characterId} slotIndex={startIndex + i} />
      ))}
    </div>
  )
}

function MultiShotButton({ characterId }: { characterId: string }) {
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const multiShotReadyAt = useRowCombatStore((state) => state.multiShotReadyAt)
  const anyEnabled = useRowCombatStore((state) => state.slots.some((s) => s.enabled))
  const [now, setNow] = useState(() => Date.now())

  if (selectedClassId !== 'hunter' || !anyEnabled) return null

  const onCooldown = now < multiShotReadyAt
  const secondsLeft = Math.ceil((multiShotReadyAt - now) / 1000)

  const handleFire = async () => {
    if (onCooldown) return
    useRowCombatStore.getState().fireMultiShotOptimistic(Date.now())
    setNow(Date.now())
    await resolveRowCombat(characterId, { fireMultiShot: true })
  }

  return (
    <Button
      variant="primary"
      disabled={onCooldown}
      onClick={() => {
        void handleFire()
        // Keep the countdown label live while on cooldown.
        const id = window.setInterval(() => setNow(Date.now()), 250)
        window.setTimeout(() => window.clearInterval(id), MULTI_SHOT_COOLDOWN_MS + 500)
      }}
      className="mb-2 w-full"
    >
      {onCooldown ? `Multi-Shot (${Math.max(0, secondsLeft)}s)` : 'Multi-Shot'}
    </Button>
  )
}

export default function RowCombatPanel({ characterId }: { characterId: string }) {
  const row1Unlocked = useRowCombatStore((state) => state.row1Unlocked)
  const row2Unlocked = useRowCombatStore((state) => state.row2Unlocked)

  return (
    <div className="mt-3 space-y-3">
      <MultiShotButton characterId={characterId} />
      {row1Unlocked ? <RowGrid characterId={characterId} row={1} /> : <RowUnlockSection characterId={characterId} row={1} />}
      {row2Unlocked ? <RowGrid characterId={characterId} row={2} /> : <RowUnlockSection characterId={characterId} row={2} />}
    </div>
  )
}
