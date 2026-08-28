import { useEffect, useState } from 'react'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { HpBar } from './CombatPage'
import { useWorldBossStore, type WorldBossAttackResult } from '../game/worldboss/useWorldBossStore'
import WorldBossLeaderboardModal from './WorldBossLeaderboardModal'
import type { EventEmberColor } from '../game/hud/useEventEmberColor'
import { useEquipmentStore, EQUIP_SLOTS } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { itemHasDurability } from '../game/items/equipmentBonus'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'

const FREE_ATTEMPT_CAP = 10
const PAID_ATTEMPT_CAP = 10
const PAID_ATTEMPT_AP_COST = 2
const ATTACK_COOLDOWN_MS = 5 * 60 * 1000

const ERROR_MESSAGES: Record<string, string> = {
  spawn_changed: 'The boss changed — try again.',
  window_ended: 'This boss fight has ended.',
  boss_defeated: 'The boss has already been defeated.',
  on_cooldown: 'Still on cooldown.',
  not_enough_ap: 'Not enough Ascension Points.',
  no_attempts_remaining: "You're out of attempts for this boss.",
  quiver_required: 'Equip a Quiver to attack.',
  not_owner: "Couldn't verify your character.",
  rpc_failed: 'Something went wrong — try again.',
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '0:00'
  const totalSeconds = Math.ceil(msRemaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function WorldBossCard({ characterId, emberColor = null }: { characterId: string; emberColor?: EventEmberColor | null }) {
  const spawn = useWorldBossStore((state) => state.spawn)
  const participation = useWorldBossStore((state) => state.participation)
  const busy = useWorldBossStore((state) => state.busy)
  const loadParticipation = useWorldBossStore((state) => state.loadParticipation)
  const attack = useWorldBossStore((state) => state.attack)

  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [lastResult, setLastResult] = useState<WorldBossAttackResult | null>(null)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [showRepairAlert, setShowRepairAlert] = useState(false)
  useLockBodyScroll(showRepairAlert)
  // Own 1s tick for the cooldown countdown — independent of CombatPage's
  // own 200ms floating-number tick, which this card doesn't use.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (spawn) {
      void loadParticipation(characterId, spawn.id)
    }
    // spawn (the whole object) deliberately excluded — WorldBossConnection
    // calls setSpawn with a brand-new object on every world_boss_spawns
    // UPDATE broadcast, which fires globally on every attack from every
    // player (HP ticking down), not just when the spawn itself changes.
    // Depending on the full object refetched participation on every other
    // player's hit while this card was mounted — a steady stream of
    // redundant queries during an active fight (reported by the user as
    // Chrome tab lag/rising memory). spawn?.id is the only real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, spawn?.id, loadParticipation])

  if (!spawn) {
    return (
      <AscensionCard>
        <p className="text-center text-sm text-slate-500">Loading the World Boss…</p>
      </AscensionCard>
    )
  }

  const freeUsed = participation?.freeAttemptsUsed ?? 0
  const paidUsed = participation?.paidAttemptsUsed ?? 0
  const freeRemaining = Math.max(0, FREE_ATTEMPT_CAP - freeUsed)
  const paidRemaining = Math.max(0, PAID_ATTEMPT_CAP - paidUsed)
  const outOfAttempts = freeRemaining === 0 && paidRemaining === 0

  const cooldownEndsAtMs = participation?.lastAttemptAt ? new Date(participation.lastAttemptAt).getTime() + ATTACK_COOLDOWN_MS : 0
  const onCooldown = cooldownEndsAtMs > now

  const windowEnded = new Date(spawn.windowEndsAt).getTime() <= now
  const bossDefeated = spawn.currentHp <= 0
  const canAttack = spawn.status === 'active' && !windowEnded && !bossDefeated && !outOfAttempts && !onCooldown && !busy

  // Broken (0-durability) gear contributes nothing to combat stats (see
  // equipmentBonus.ts) — attacking the World Boss with it equipped would
  // just burn a limited attempt for a weak hit, so warn before spending one.
  const hasBrokenGear = EQUIP_SLOTS.some((slot) => {
    const itemId = equippedIds[slot]
    const item = itemId ? items.find((entry) => entry.id === itemId) : null
    if (!item) return false
    const template = templates.find((entry) => entry.id === item.template_id)
    return itemHasDurability(template?.slot_type) && item.durability <= 0
  })

  const handleAttack = async () => {
    if (hasBrokenGear) {
      setShowRepairAlert(true)
      return
    }
    const result = await attack(characterId)
    setLastResult(result)
  }

  return (
    <AscensionCard activeEventColor={emberColor}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-heading-label" style={{ fontSize: '1.4rem' }}>
            World Boss
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {bossDefeated ? 'Defeated — rewards have been mailed out' : windowEnded ? 'Fight ended' : 'Active'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLeaderboardOpen(true)}
          title="Leaderboard"
          className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-lg hover:bg-amber-500/20"
        >
          🏆
        </button>
      </div>

      <div
        className={`mt-3 flex h-32 w-32 items-center justify-center rounded-2xl border-2 border-slate-700 bg-gradient-to-br from-rose-900 to-slate-950 text-5xl ${
          bossDefeated ? 'opacity-40 grayscale' : ''
        }`}
      >
        👹
      </div>

      <div className="mt-3">
        <p className="text-xs text-slate-500">
          {spawn.currentHp.toLocaleString()} / {spawn.maxHp.toLocaleString()} HP
        </p>
        <div className="mt-1">
          <HpBar current={spawn.currentHp} max={spawn.maxHp} barColorClass="bg-rose-500" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-center">
          <p className="text-slate-500">Free attempts</p>
          <p className="text-sm font-medium text-slate-200">
            {freeRemaining} / {FREE_ATTEMPT_CAP}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-center">
          <p className="text-slate-500">Paid attempts</p>
          <p className="text-sm font-medium text-slate-200">
            {paidRemaining} / {PAID_ATTEMPT_CAP}
          </p>
        </div>
      </div>

      {onCooldown && <p className="mt-2 text-center text-xs text-slate-500">Next attempt in {formatCountdown(cooldownEndsAtMs - now)}</p>}

      {hasBrokenGear && <p className="mt-2 text-center text-xs text-rose-400">Some of your gear is broken — repair it before fighting.</p>}

      <Button variant="primary" disabled={!canAttack} onClick={() => void handleAttack()} className="mt-3 w-full">
        {busy ? 'Attacking…' : freeRemaining > 0 ? 'Attack' : `Attack (${PAID_ATTEMPT_AP_COST} AP)`}
      </Button>

      {lastResult && (
        <p className={`mt-2 text-center text-sm font-medium ${lastResult.ok ? 'text-amber-300' : 'text-rose-400'}`}>
          {lastResult.ok
            ? `You dealt ${lastResult.damage?.toLocaleString()} damage!`
            : (ERROR_MESSAGES[lastResult.error ?? 'rpc_failed'] ?? 'Something went wrong.')}
        </p>
      )}

      {participation && (
        <p className="mt-2 text-center text-xs text-slate-500">Your total damage: {participation.totalDamage.toLocaleString()}</p>
      )}

      {leaderboardOpen && (
        <WorldBossLeaderboardModal characterId={characterId} spawnId={spawn.id} onClose={() => setLeaderboardOpen(false)} />
      )}

      {showRepairAlert && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={() => setShowRepairAlert(false)}
        >
          <div
            className="w-full max-w-xs space-y-3 rounded-2xl border border-rose-500/40 bg-slate-900 p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-rose-300">Gear needs repair</p>
            <p className="text-xs text-slate-400">
              One or more of your equipped items is at 0 durability and won't fight effectively. Repair your gear in the Shop before
              attacking the World Boss.
            </p>
            <Button variant="primary" onClick={() => setShowRepairAlert(false)} className="w-full">
              Got it
            </Button>
          </div>
        </div>
      )}
    </AscensionCard>
  )
}
