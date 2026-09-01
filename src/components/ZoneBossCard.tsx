import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { IconButton, HelpCircleIcon } from './ui/IconButton'
import { HpBar } from './CombatPage'
import { useZoneBossStore, type ZoneBossAttackResult } from '../game/zoneboss/useZoneBossStore'
import ZoneBossLeaderboardModal from './ZoneBossLeaderboardModal'
import ZoneBossRewardsInfoModal from './ZoneBossRewardsInfoModal'
import type { EventEmberColor } from '../game/hud/useEventEmberColor'
import { useEquipmentStore, EQUIP_SLOTS } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { itemHasDurability } from '../game/items/equipmentBonus'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'
import { zoneBossForId } from '../game/zones/zoneBossData'

const FREE_ATTEMPT_CAP = 10
const PAID_ATTEMPT_CAP = 10
const PAID_ATTEMPT_AP_COST = 2
const ATTACK_COOLDOWN_MS = 5 * 60 * 1000
// Per-character contribution cap (2026-11-14) — mirrors apply_world_boss_attack's
// own v_cap := round(v_max_hp * 0.34). Guarantees killing any boss needs
// damage from at least 3 distinct characters (3 * 34% > 100%), and whoever
// hits their own cap first is guaranteed the spawn's top total_damage.
const DAMAGE_CAP_PCT = 0.34

const ERROR_MESSAGES: Record<string, string> = {
  spawn_changed: 'The boss changed — try again.',
  window_ended: 'This boss fight has ended.',
  boss_defeated: 'The boss has already been defeated.',
  on_cooldown: 'Still on cooldown.',
  not_enough_ap: 'Not enough Ascension Points.',
  no_attempts_remaining: "You're out of attempts for this boss.",
  damage_cap_reached: "You've already dealt your max damage to this boss.",
  quiver_required: 'Equip a Quiver to attack.',
  not_owner: "Couldn't verify your character.",
  other_character_active: 'Another character on your account is already fighting this boss.',
  rpc_failed: 'Something went wrong — try again.',
}

// "Do not show me this again" preference for the first-attack confirmation
// below — a plain client-side convenience, not account state, so a flat
// localStorage flag (not scoped per-account) is fine; worst case a shared
// browser sees the confirmation once more than strictly necessary.
const SKIP_CONFIRM_KEY = 'ascension-zone-boss-skip-attack-confirm'

function getSkipAttackConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_CONFIRM_KEY) === '1'
  } catch {
    return false
  }
}

function setSkipAttackConfirm(): void {
  try {
    localStorage.setItem(SKIP_CONFIRM_KEY, '1')
  } catch {
    // Not worth failing the attack over — just means the confirmation
    // reappears next time.
  }
}

// Also used for the fight-window countdown below (2026-08-29, added
// alongside it) — the window runs 6-8 hours (see CLAUDE.server-events.md),
// so this needs an hours place the original 5-minute-attack-cooldown-only
// version never did; the minutes:seconds form still applies whenever hours
// is 0, so the existing cooldown call site is unaffected.
function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '0:00'
  const totalSeconds = Math.ceil(msRemaining / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function ZoneBossCard({ characterId, emberColor = null }: { characterId: string; emberColor?: EventEmberColor | null }) {
  const spawn = useZoneBossStore((state) => state.spawn)
  const participation = useZoneBossStore((state) => state.participation)
  const busy = useZoneBossStore((state) => state.busy)
  const loadParticipation = useZoneBossStore((state) => state.loadParticipation)
  const attack = useZoneBossStore((state) => state.attack)

  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [lastResult, setLastResult] = useState<ZoneBossAttackResult | null>(null)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [rewardsInfoOpen, setRewardsInfoOpen] = useState(false)
  const [showRepairAlert, setShowRepairAlert] = useState(false)
  const [showAttackConfirm, setShowAttackConfirm] = useState(false)
  const [skipConfirmChecked, setSkipConfirmChecked] = useState(false)
  // Top-damage entry for the "who won" line on the defeated-boss results
  // card below — fetched from the same leaderboard RPC the trophy modal
  // uses, just for rank 1, once the boss has actually died.
  const [winner, setWinner] = useState<{ name: string; damage: number } | null>(null)
  useLockBodyScroll(showRepairAlert || showAttackConfirm)
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
    // spawn (the whole object) deliberately excluded — ZoneBossConnection
    // calls setSpawn with a brand-new object on every world_boss_spawns
    // UPDATE broadcast, which fires globally on every attack from every
    // player (HP ticking down), not just when the spawn itself changes.
    // Depending on the full object refetched participation on every other
    // player's hit while this card was mounted — a steady stream of
    // redundant queries during an active fight (reported by the user as
    // Chrome tab lag/rising memory). spawn?.id is the only real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, spawn?.id, loadParticipation])

  const defeated = !!spawn && spawn.currentHp <= 0

  useEffect(() => {
    if (!defeated || !spawn) {
      setWinner(null)
      return
    }
    let cancelled = false
    void supabase
      .rpc('get_world_boss_leaderboard', { p_character_id: characterId, p_spawn_id: spawn.id })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('get_world_boss_leaderboard call failed', error)
          return
        }
        const result = data as { ok: boolean; entries: { character_name: string; total_damage: number }[] }
        if (result.ok && result.entries.length > 0) {
          setWinner({ name: result.entries[0].character_name, damage: result.entries[0].total_damage })
        }
      })
    return () => {
      cancelled = true
    }
    // spawn (the whole object) deliberately excluded — same reasoning as the
    // loadParticipation effect above, this should only refetch when the
    // defeated-ness or the spawn itself actually changes, not on every HP
    // tick broadcast while the fight is still live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defeated, spawn?.id, characterId])

  if (!spawn) {
    return (
      <AscensionCard>
        <p className="text-center text-sm text-slate-300">Loading the Zone Boss…</p>
      </AscensionCard>
    )
  }

  const boss = zoneBossForId(spawn.bossId)

  // Defeated (killed before its window ran out) gets a distinct results
  // card instead of the fight UI — nothing left to attack, and status stays
  // 'active' on the spawn row until the full window elapses (see
  // useZoneBossStore.ts), so the fight UI would otherwise linger showing a
  // 0 HP bar and a disabled Attack button for hours after the kill.
  if (defeated) {
    return (
      <AscensionCard>
        <div className="flex items-start justify-between gap-2">
          <p className="text-heading-label" style={{ fontSize: '1.4rem' }}>
            {boss.displayName} Defeated
          </p>
          <IconButton icon="🏆" title="Leaderboard" accent="amber" onClick={() => setLeaderboardOpen(true)} />
        </div>

        <div
          role="img"
          aria-label={boss.displayName}
          className="mt-3 aspect-[16/9] w-full overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 bg-cover bg-center opacity-40 grayscale"
          style={{ backgroundImage: `url(${boss.imageUrl})` }}
        />

        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-center">
          <p className="text-sm font-medium text-amber-200">
            {winner ? `🏆 ${winner.name} led the assault with ${winner.damage.toLocaleString()} damage` : 'Tallying the results…'}
          </p>
        </div>

        <p className="mt-3 text-center text-xs text-slate-300">Rewards have been mailed out to everyone who took part.</p>
        <p className="mt-1 text-center text-xs text-slate-300">A new Zone Boss will appear within the next few hours.</p>

        {leaderboardOpen && (
          <ZoneBossLeaderboardModal characterId={characterId} spawnId={spawn.id} bossName={boss.displayName} onClose={() => setLeaderboardOpen(false)} />
        )}
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

  const windowEndsAtMs = new Date(spawn.windowEndsAt).getTime()
  const windowEnded = windowEndsAtMs <= now
  const damageCap = Math.round(spawn.maxHp * DAMAGE_CAP_PCT)
  const damageCapReached = (participation?.totalDamage ?? 0) >= damageCap
  const canAttack = spawn.status === 'active' && !windowEnded && !outOfAttempts && !onCooldown && !damageCapReached && !busy

  // Broken (0-durability) gear contributes nothing to combat stats (see
  // equipmentBonus.ts) — attacking the Zone Boss with it equipped would
  // just burn a limited attempt for a weak hit, so warn before spending one.
  const hasBrokenGear = EQUIP_SLOTS.some((slot) => {
    const itemId = equippedIds[slot]
    const item = itemId ? items.find((entry) => entry.id === itemId) : null
    if (!item) return false
    const template = templates.find((entry) => entry.id === item.template_id)
    return itemHasDurability(template?.slot_type) && (item.durability ?? 0) <= 0
  })

  const performAttack = async () => {
    const result = await attack(characterId)
    setLastResult(result)
  }

  const handleAttack = () => {
    if (hasBrokenGear) {
      setShowRepairAlert(true)
      return
    }
    if (getSkipAttackConfirm()) {
      void performAttack()
      return
    }
    setSkipConfirmChecked(false)
    setShowAttackConfirm(true)
  }

  const handleConfirmAttack = () => {
    if (skipConfirmChecked) setSkipAttackConfirm()
    setShowAttackConfirm(false)
    void performAttack()
  }

  return (
    <AscensionCard activeEventColor={emberColor}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-heading-label" style={{ fontSize: '1.4rem' }}>
            {boss.displayName}
            <IconButton
              icon={<HelpCircleIcon className="h-4 w-4" />}
              title="How rewards work"
              accent="sky"
              variant="bare"
              onClick={() => setRewardsInfoOpen(true)}
            />
          </p>
          <p className="mt-1 text-xs text-slate-300">{windowEnded ? 'Fight ended' : `Active — ends in ${formatCountdown(windowEndsAtMs - now)}`}</p>
        </div>
        <IconButton icon="🏆" title="Leaderboard" accent="amber" onClick={() => setLeaderboardOpen(true)} />
      </div>

      <div
        role="img"
        aria-label={boss.displayName}
        className="mt-3 aspect-[16/9] w-full overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 bg-cover bg-center"
        style={{ backgroundImage: `url(${boss.imageUrl})` }}
      />

      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="rounded-full border border-emerald-500 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          {boss.defenseProfile === 'physical' ? 'High Def' : 'High M-Def'}
        </span>
        <span className="rounded-full border border-rose-500 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300">
          {boss.defenseProfile === 'physical' ? 'Low M-Def' : 'Low Def'}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-xs text-slate-300">
          {spawn.currentHp.toLocaleString()} / {spawn.maxHp.toLocaleString()} HP
        </p>
        <div className="mt-1">
          <HpBar current={spawn.currentHp} max={spawn.maxHp} barColorClass="bg-rose-500" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-center">
          <p className="text-slate-300">Free attempts</p>
          <p className="text-sm font-medium text-slate-200">
            {freeRemaining} / {FREE_ATTEMPT_CAP}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-center">
          <p className="text-slate-300">Paid attempts</p>
          <p className="text-sm font-medium text-slate-200">
            {paidRemaining} / {PAID_ATTEMPT_CAP}
          </p>
        </div>
      </div>

      {onCooldown && !damageCapReached && (
        <p className="mt-2 text-center text-xs text-slate-300">Next attempt in {formatCountdown(cooldownEndsAtMs - now)}</p>
      )}

      {damageCapReached && !windowEnded && (
        <p className="mt-2 text-center text-xs text-slate-300">You've dealt your max damage to this boss — let others finish it off.</p>
      )}

      {hasBrokenGear && <p className="mt-2 text-center text-xs text-rose-400">Some of your gear is broken — repair it before fighting.</p>}

      <Button variant="primary" disabled={!canAttack} onClick={handleAttack} className="mt-3 w-full">
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
        <p className="mt-2 text-center text-xs text-slate-300">
          Your total damage: {participation.totalDamage.toLocaleString()} / {damageCap.toLocaleString()} cap
        </p>
      )}

      {leaderboardOpen && (
        <ZoneBossLeaderboardModal characterId={characterId} spawnId={spawn.id} bossName={boss.displayName} onClose={() => setLeaderboardOpen(false)} />
      )}

      {rewardsInfoOpen && (
        <ZoneBossRewardsInfoModal bossName={boss.displayName} rewardPool={spawn.rewardPool} onClose={() => setRewardsInfoOpen(false)} />
      )}

      {showAttackConfirm &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
            onClick={() => setShowAttackConfirm(false)}
          >
            <div
              className="w-full max-w-xs space-y-3 rounded-2xl border border-amber-500/40 bg-slate-900 p-4 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="text-sm font-semibold text-amber-200">Attack with this character?</p>
              <p className="text-xs text-slate-400">
                Only one character per account can fight a Zone Boss at a time. Once this character lands a hit on {boss.displayName},
                no other character on your account will be able to join this fight.
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={skipConfirmChecked}
                  onChange={(event) => setSkipConfirmChecked(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500"
                />
                Do not show me this message again
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setShowAttackConfirm(false)} className="flex-1">
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleConfirmAttack} className="flex-1">
                  Confirm
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {showRepairAlert &&
        createPortal(
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
                attacking the Zone Boss.
              </p>
              <Button variant="primary" onClick={() => setShowRepairAlert(false)} className="w-full">
                Got it
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </AscensionCard>
  )
}
