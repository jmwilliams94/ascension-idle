import { create } from 'zustand'
import { computeDerivedStats } from '../stats/derivedStats'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { computeEquipmentBonus } from '../items/equipmentBonus'
import { useEquipmentStore } from '../items/useEquipmentStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { useNoQuiverWarningStore } from '../items/useNoQuiverWarningStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useAchievementsStore } from '../achievements/useAchievementsStore'
import { getActiveGoldDonationEvent, useGoldDonationStore } from '../goldDonation/useGoldDonationStore'
import { ENEMY_TYPES, zoneIdForMonster, type EnemyTypeId } from '../zones/zoneData'
import { SKILL_TYPES } from '../skills/skillData'
import { useSkillsStore } from '../skills/useSkillsStore'
import {
  MONSTER_ATTACK_INTERVAL_MS,
  applyDamageReduction,
  deepBlackDamageMultiplier,
  expMultiplierForLevelDiff,
  killRewards,
  monsterAttackDamage,
  monsterDefense,
  monsterMagicDefense,
  monsterDodge,
  playerDefenseMultiplierForLevelDiff,
  resolvePhysicalDamage,
  rollAttackLands,
  rollBonusCurrencyDrops,
  rollJadeShardDrop,
  rollDamageInRange,
  rollIsHit,
  isRareKillNumber,
  spawnMonsterHp,
} from './combatResolver'

export type CombatLogKind =
  | 'engage'
  | 'damage'
  | 'player-damage'
  | 'dodge'
  | 'miss'
  | 'kill'
  | 'rare-kill'
  | 'item'
  | 'currency'
  | 'no-quiver'
  | 'no-mana'
  | 'knockout'
  | 'inventory-full'
  | 'pet'

export interface CombatLogEntry {
  id: string
  kind: CombatLogKind
  message: string
  timestamp: number
  // Present on 'damage' entries only — lets the UI drive floating damage numbers
  // without parsing the message text.
  amount?: number
}

// Keeps the log from growing unbounded across a long idle session — only the most
// recent entries matter for the UI, unlike gold/EXP which are cumulative totals
// tracked separately by useProgressionStore.
const LOG_CAP = 40

// Death timer (confirmed with the user, 2026-08-05 — "enemies don't feel
// punishing enough") — see the CombatState.reviveAt field comment below for
// the full mechanic. PLACEHOLDER duration, same disclosed-not-final status as
// the rest of this combat system.
const KNOCKOUT_LOCKOUT_MS = 10_000

// Monster respawn gap (2026-08-17, requested by the user) — replaces the
// original instant-respawn-on-kill behavior ("Monster respawns immediately
// (no respawn timer) — fight continuously until selection changes"). At a
// 1-attack/sec weapon, instant respawn made it look like more than one kill
// could land per attack-interval tick once a monster's remaining HP got low
// relative to hit damage. Raised 2s -> 10s (2026-11, requested by the user
// alongside the weapon-curve/enemy-HP rebalance, to match the slower,
// more-hits-per-kill pacing that rebalance produces) — mirrored in
// resolve-combat/index.ts's own RESPAWN_GAP_MS, must stay in sync.
// **No longer additive on top of the fight (2026-11, requested by the
// user — "if it takes 5 seconds to kill it's only got 5 seconds remaining
// till the next one spawns")**: the gap now runs concurrently with the
// fight itself, starting the moment a monster spawns (see
// currentMonsterSpawnedAt), so it's effectively a floor on the total
// spawn-to-next-spawn duration rather than dead time tacked on after every
// kill. Still fully gates a fast/one-shot kill the same as before (a 1s
// kill still can't respawn faster than once per RESPAWN_GAP_MS) — only
// fights that already take longer than the gap on their own see it shrink
// or disappear entirely. A monster that's still alive is never reset or
// replaced by this timer; it only ever affects what happens once the
// current one is already dead.
export const RESPAWN_GAP_MS = 10_000

function appendLog(log: CombatLogEntry[], entry: Omit<CombatLogEntry, 'id' | 'timestamp'>): CombatLogEntry[] {
  const full: CombatLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  return [...log, full].slice(-LOG_CAP)
}

interface CombatState {
  isFighting: boolean
  monsterTypeId: EnemyTypeId | null
  // Bumped on every spawn/respawn so the HP bar/portrait can key off it and remount/
  // reset its transition cleanly rather than animating from the previous monster's HP.
  monsterInstanceKey: number
  currentHp: number
  maxHp: number
  isRareInstance: boolean
  // Deterministic rare cadence (2026-08-31, replaces an independent
  // 5%-per-spawn RNG roll — see combatResolver.ts's isRareKillNumber/
  // RARE_KILL_INTERVAL comment) — this client's own best-known count of how
  // many of the CURRENTLY selected monster have been killed so far,
  // seeded from useAchievementsStore's confirmed count on every start()
  // (monster select/switch), incremented on every local kill, and snapped
  // forward (never backward) by syncKillsTowardRare whenever a resolve-
  // combat response confirms a higher real count. The next spawn's rarity
  // is isRareKillNumber(killsTowardRare + 1). Kept in sync with the
  // server's own identical formula (built off its own authoritative
  // running count, see resolve-combat/index.ts's characterKillsBefore) so
  // the two sides only disagree when their kill counts themselves are
  // briefly out of sync, not on an unlucky coin flip.
  killsTowardRare: number
  // The player's own HP — continuous across monster respawns/zone switches (only
  // reset by a knockout, not by start()/stop()/clear()), unlike the monster's own
  // currentHp/maxHp above. 0/0 is a sentinel meaning "never initialized yet";
  // runTick lazily fills both in from derived.hp the first time it ticks.
  currentPlayerHp: number
  maxPlayerHp: number
  // The player's own MP pool (2026-10, first real consumer — see
  // src/game/skills/skillData.ts) — same lazy-init-from-derived-stats/
  // continuous-across-respawns shape as currentPlayerHp/maxPlayerHp above,
  // except only an equipped skill's own mpCost ever drains it (no incoming-
  // damage equivalent). Restored only by Mana potions (restorePlayerMp) —
  // no passive regen, matching this game's existing "HP never regens on its
  // own either" precedent.
  currentPlayerMp: number
  maxPlayerMp: number
  // Small residual drift between this local prediction and resolve-combat's
  // own authoritative value (v1.125.39, reported by the user — mana visibly
  // "gives back" 1-3 points right after a kill, most often exactly 1).
  // Root cause: the two sides fundamentally use different models for the
  // same real time window — this file ticks in discrete whole attacks (an
  // attack only fires once a full attackIntervalMs has genuinely elapsed),
  // while resolve-combat's walkCombat computes a fully continuous "attack
  // time consumed" from real elapsed wall-clock time (necessarily so, since
  // that's also the model gold/EXP/kills already use) — the two will almost
  // never land on the exact same whole-number cast count for the same real
  // window. Folded into the next cast's own effective cost instead of
  // snapping the bar on sync, same "reads as a slightly cheaper/pricier
  // cast rather than an unexplained bar jump" precedent as
  // pendingHpAdjustment below. Only ever holds an amount to give back
  // (positive) — syncPlayerMp applies a shortfall (the server confirming
  // *less* remaining than shown) immediately instead, since mana dropping
  // further mid-fight is already expected and unremarkable.
  pendingMpAdjustment: number
  // Death timer (confirmed with the user, 2026-08-05, replaces the earlier
  // "instant full heal, fight stops" placeholder). Nonzero while the player
  // is incapacitated after a knockout: the nowMs timestamp when they can act
  // again. While incapacitated, runTick skips both the player's own attack
  // and the monster's attack-back entirely — neither side acts for
  // KNOCKOUT_LOCKOUT_MS. isFighting stays true and the monster's own
  // currentHp/maxHp are left untouched throughout, so the fight genuinely
  // resumes exactly where it was once the player revives (to full HP)
  // rather than the monster respawning fresh. 0 means "not incapacitated."
  reviveAt: number
  // Monster respawn gap (see RESPAWN_GAP_MS) — 0 means a monster is present
  // (or the fight hasn't started). Nonzero is the nowMs timestamp the next
  // monster will appear; while waiting, currentHp/maxHp are 0 (nothing to
  // show/attack) and runTick skips both the player's own attack and the
  // monster's attack-back, same "neither side acts" shape reviveAt uses.
  // **Only ever entered if the gap hasn't already elapsed by kill time**
  // (2026-11, requested by the user — see currentMonsterSpawnedAt below); a
  // fight slow enough to outlast RESPAWN_GAP_MS on its own skips this state
  // entirely and the next monster appears the instant the current one dies.
  respawnReadyAt: number
  // The nowMs timestamp the current monster instance appeared (set by
  // start() and by both places a new instance spawns in runTick below) —
  // the respawn gap now runs concurrently with the fight from this moment,
  // not additively after the kill (2026-11, requested by the user: "if it
  // takes 5 seconds to kill it's only got 5 seconds remaining till the next
  // one spawns"). At kill time, `currentMonsterSpawnedAt + RESPAWN_GAP_MS`
  // is the real deadline: if already passed, spawn immediately; otherwise
  // respawnReadyAt is set to that same deadline (not nowMs + RESPAWN_GAP_MS)
  // so the remaining wait is exactly whatever's left of the gap. Deliberately
  // never consulted anywhere else — a monster that's still alive is never
  // reset/replaced just because this timer elapses; it only ever gates what
  // happens once the current one is already dead.
  currentMonsterSpawnedAt: number
  // Monotonically increasing counter, bumped on every real kill regardless
  // of whether the gap above produces a visible waiting state or an instant
  // respawn (2026-11) — CombatEngine.tsx watches this (not respawnReadyAt's
  // own 0->nonzero transition, which no longer fires on every kill now that
  // a slow fight can skip the waiting state entirely) to trigger an
  // immediate server reconcile right on the kill moment.
  lastKillSignal: number
  // Small same-instance HP drift from resolve-combat's own real tracked
  // instance, deferred rather than snapped instantly (v1.123.3, see
  // syncMonsterInstance's own comment) — folded into the *next* real local
  // hit's damage number instead, so the correction reads as "that hit landed
  // a bit harder/softer than usual" rather than an unexplained bar jump.
  // Positive means the real monster has *more* HP than currently shown
  // (reduce the next hit's effective damage); negative means less (the next
  // hit lands harder). Always cleared to 0 whenever the instance itself
  // changes (kill, respawn, fresh start, or a forward resync) — a correction
  // computed against one instance's HP scale is meaningless against a
  // different one's.
  pendingHpAdjustment: number
  log: CombatLogEntry[]
  lastAttackAt: number
  lastMonsterAttackAt: number
  // Selects a monster and begins fighting it. Safe to call again with the same or a
  // different monster — always starts a fresh instance (no "resume mid-HP").
  start: (monsterTypeId: EnemyTypeId) => void
  stop: () => void
  // Fully resets the active-fight state (unlike stop(), which only pauses) —
  // called when switching zones, since a monster from one zone shouldn't still
  // show as the "paused" fight (with a Resume button) once you're looking at a
  // different zone's roster. Keeps the log for continuity.
  clear: () => void
  // Driven by CombatEngine's interval — a no-op if not currently fighting or if the
  // attack-speed cooldown hasn't elapsed yet.
  runTick: (nowMs: number) => void
  // Called by usePotionStore.usePotion for an HP potion — heals the player's
  // current HP, clamped to their max. No-ops if maxPlayerHp hasn't been
  // lazily initialized yet (0/0 sentinel — see the field comments above),
  // since there's nothing meaningful to clamp against before combat has
  // ticked at least once.
  healPlayerHp: (amount: number) => void
  // Called by usePotionStore.usePotion for a Mana potion — same clamp-to-max/
  // no-op-before-lazy-init shape as healPlayerHp above.
  restorePlayerMp: (amount: number) => void
  // Called by resolveCombat.ts whenever a resolve response reports a real
  // (non-null) authoritative currentMp — 2026-11 bug fix (reported by the
  // user: EXP silently stopped moving despite visibly landing kills
  // client-side). Overwrites, doesn't add — currentPlayerMp used to be a
  // purely client-local simulation with no connection to resolve-combat's
  // own persisted characters.current_mp at all, so the two could drift
  // (typically the server's copy drains faster in wall-clock terms, since it
  // assumes continuous attacking across the *entire* elapsed window same as
  // the gold/EXP math, hitting 0 and silently zeroing every future
  // kill/reward long before the client's own MP bar showed empty). No-ops
  // before lazy-init (0/0 sentinel), same as healPlayerHp/restorePlayerMp.
  syncPlayerMp: (amount: number) => void
  // Reconciles the visual fight to resolve-combat's own real tracked
  // instance (v1.123.0 per-instance rewrite, bug fix reported by the user —
  // a toast landed mid-fight against a monster the client still showed
  // alive, "every ~10 seconds"). The client's own currentHp/isRareInstance
  // above are rolled independently (own RNG, own timing) purely for instant
  // visual feedback — without this, they can diverge arbitrarily far from
  // resolve-combat's own real instance, which now drives real reward
  // crediting on its own real timing regardless of what's on screen. Called
  // by resolveCombat.ts on every live response that carries a real instance
  // (mode: 'live' only — offline resolves happen before start() ever runs,
  // which always spawns fresh anyway). No-ops if the response is for a
  // different monster than what's currently selected, or if not actively
  // fighting at all (a local switch/stop already in flight shouldn't be
  // stomped by a stale response for the old monster).
  // serverNowMs is resolve-combat's own reference clock at the moment it
  // computed `instance` (see resolveCombat.ts's own `now` field) — every
  // timestamp on `instance` is converted to a duration relative to this
  // before being re-anchored to the client's own Date.now() below, so a
  // client device clock running seconds off from the server (a real
  // reported bug — the respawn countdown jumped to a nonsensical value on
  // every sync) can never leak into displayed/simulated timing. Defaults to
  // Date.now() (no correction) only for a stale client bundle predating
  // this field.
  syncMonsterInstance: (
    instance: {
      monster_id: string
      hp: number
      is_rare: boolean
      spawned_at: string | null
      respawn_at: string | null
    },
    serverNowMs: number,
  ) => void
  // Called by resolveCombat.ts on every live response that reports a
  // characterKillCount — keeps killsTowardRare from silently drifting
  // behind the server's own authoritative count (e.g. a resolve call that
  // batches more than one real kill). No-ops for a different monster than
  // the one currently selected, or if confirmedCount isn't actually ahead
  // of what's already tracked (never moves the cadence backward).
  syncKillsTowardRare: (monsterId: string, confirmedCount: number) => void
  // Called by resolveCombat.ts when a live (not offline) resolve-combat
  // response reports inventoryFull — a kill rolled a drop that had nowhere
  // to go, so the fight stops outright rather than silently discarding it or
  // parking it in Loot Holding (confirmed with the user, 2026-07-31: "a full
  // inventory should stop combat," Loot Holding is for idle/offline overflow
  // only now — see CLAUDE.md's Loot section).
  stopForInventoryFull: () => void
  // Called by resolveCombat.ts when a response reports petObtained —
  // Achievements & Pets, Stage 1 (see CLAUDE.md). Just a log line, no other
  // state change — the pet unlock itself already happened server-side.
  logPetObtained: (monsterName: string) => void
  // Row Combat (Phase 1) support — player HP/knockout is one shared pool
  // across single-target and row combat (the same character, same HP bar),
  // so useRowCombatStore's own tick loop calls into these rather than
  // forking a second HP pool. Mirrors runTick's own inline revive-check/
  // incoming-damage logic above; kept as separate small methods rather than
  // refactoring runTick to call them, to avoid touching proven behavior.
  //
  // Returns true if the player is still incapacitated (or was incapacitated
  // and has just revived this call) — callers should skip their own action
  // for this tick when true, same "revive fully, resume next tick" shape
  // runTick's own reviveAt handling uses.
  isKnockedOutAt: (nowMs: number) => boolean
  // Applies a single already-fully-computed hit (defense/damage-reduction
  // already applied by the caller, same as runTick's own `damage` value) to
  // the shared player HP pool. No-ops while already knocked out or before
  // maxPlayerHp has been lazily initialized (mirrors runTick's own guards).
  applyIncomingDamage: (damage: number, nowMs: number, sourceName: string) => void
}

export const useCombatStore = create<CombatState>((set, get) => ({
  isFighting: false,
  monsterTypeId: null,
  monsterInstanceKey: 0,
  currentHp: 0,
  maxHp: 0,
  isRareInstance: false,
  killsTowardRare: 0,
  currentPlayerHp: 0,
  maxPlayerHp: 0,
  currentPlayerMp: 0,
  maxPlayerMp: 0,
  pendingMpAdjustment: 0,
  reviveAt: 0,
  respawnReadyAt: 0,
  currentMonsterSpawnedAt: 0,
  lastKillSignal: 0,
  pendingHpAdjustment: 0,
  log: [],
  lastAttackAt: 0,
  lastMonsterAttackAt: 0,

  start: (monsterTypeId) => {
    const type = ENEMY_TYPES[monsterTypeId]
    // Seeded fresh from the confirmed ladder on every select/switch (see
    // killsTowardRare's own field comment) rather than carried over from
    // whatever monster was fought before.
    const killsTowardRare = useAchievementsStore.getState().characterKills[monsterTypeId]?.kills ?? 0
    const isRare = isRareKillNumber(killsTowardRare + 1)
    const hp = spawnMonsterHp(type, isRare)
    const nowMs = Date.now()

    set((state) => ({
      isFighting: true,
      monsterTypeId,
      monsterInstanceKey: state.monsterInstanceKey + 1,
      currentHp: hp,
      maxHp: hp,
      isRareInstance: isRare,
      killsTowardRare,
      lastAttackAt: 0,
      lastMonsterAttackAt: 0,
      // Clears any stale death-timer lockout from before a manual Stop —
      // starting a fresh fight should never inherit an old incapacitation.
      reviveAt: 0,
      respawnReadyAt: 0,
      currentMonsterSpawnedAt: nowMs,
      pendingHpAdjustment: 0,
      log: appendLog(state.log, {
        kind: 'engage',
        message: isRare ? `A rare ${type.displayName} appears!` : `You engage a ${type.displayName}.`,
      }),
    }))
  },

  stop: () => set({ isFighting: false }),

  clear: () =>
    set({
      isFighting: false,
      monsterTypeId: null,
      currentHp: 0,
      maxHp: 0,
      isRareInstance: false,
      respawnReadyAt: 0,
      currentMonsterSpawnedAt: 0,
      // currentPlayerHp/maxPlayerHp deliberately NOT reset here — the player's own
      // HP is continuous across zone/monster switches, not tied to a specific
      // fight the way the monster's own HP is.
    }),

  runTick: (nowMs) => {
    const state = get()

    if (!state.isFighting || !state.monsterTypeId) {
      return
    }

    // Death timer (see the CombatState.reviveAt field comment) — while
    // incapacitated, neither side acts at all this tick. Once the window
    // elapses, revive to full HP and let the *next* tick resume normal
    // combat (deliberately not falling through to attack in this same tick,
    // so a revive always gets at least one tick's worth of genuine safety).
    if (state.reviveAt > 0) {
      if (nowMs < state.reviveAt) {
        return
      }
      set((s) => ({
        reviveAt: 0,
        currentPlayerHp: s.maxPlayerHp,
        log: appendLog(s.log, { kind: 'knockout', message: 'You revive and rejoin the fight!' }),
      }))
      return
    }

    // Monster respawn gap (see RESPAWN_GAP_MS/respawnReadyAt) — while
    // waiting, neither side acts, same "nothing to fight" shape the
    // knockout gate above uses. Once the gap elapses, spawn a fresh
    // instance and let the *next* tick resume actual combat (same
    // one-tick-for-the-transition pattern the revive branch above uses).
    if (state.respawnReadyAt > 0) {
      if (nowMs < state.respawnReadyAt) {
        return
      }
      const respawnType = ENEMY_TYPES[state.monsterTypeId]
      const nextIsRare = isRareKillNumber(state.killsTowardRare + 1)
      const nextHpValue = spawnMonsterHp(respawnType, nextIsRare)
      set((s) => ({
        respawnReadyAt: 0,
        currentMonsterSpawnedAt: nowMs,
        monsterInstanceKey: s.monsterInstanceKey + 1,
        currentHp: nextHpValue,
        maxHp: nextHpValue,
        isRareInstance: nextIsRare,
        pendingHpAdjustment: 0,
        // Reset both attack cadences to the spawn moment (bug fix, reported
        // by the user, 2026-08-17) — previously left untouched through the
        // gap, so on respawn the very next 100ms tick's cooldown check
        // (`nowMs - lastAttackAt >= attackIntervalMs`) already passed
        // (lastAttackAt was RESPAWN_GAP_MS-plus-old), letting the first hit
        // land almost instantly instead of a full attackIntervalMs after
        // the monster actually appeared. Applies symmetrically to the
        // monster's own attack-back for the same reason.
        lastAttackAt: nowMs,
        lastMonsterAttackAt: nowMs,
        log: appendLog(
          s.log,
          nextIsRare
            ? { kind: 'engage', message: `A rare ${respawnType.displayName} appears!` }
            : { kind: 'engage', message: `A new ${respawnType.displayName} appears.` },
        ),
      }))
      return
    }

    const type = ENEMY_TYPES[state.monsterTypeId]
    const { selectedClassId, attributes } = useCharacterStore.getState()
    const characterLevel = useProgressionStore.getState().level
    const equipmentBonus = computeEquipmentBonus(
      useEquipmentStore.getState().equippedIds,
      useInventoryStore.getState().items,
      useItemTemplatesStore.getState().templates,
    )
    const derived = computeDerivedStats(attributes, equipmentBonus)

    // Active skill (2026-10, see src/game/skills/skillData.ts) — replaces the
    // regular auto-attack entirely while equipped: its own attack-interval
    // (not derived.attackSpeed) and a magic-only damage formula (see
    // attackMidpoint below), per CLAUDE.combat-and-loot.md's "Confirmed
    // future design" note. Class-revalidated here rather than trusting
    // useSkillsStore's own equippedSkillId at face value — mirrors the
    // "server never trusts client params" doctrine even though this
    // particular check is itself client-side (resolve-combat re-derives its
    // own copy independently, see that file).
    const equippedSkillId = useSkillsStore.getState().equippedSkillId
    const candidateSkill = equippedSkillId ? SKILL_TYPES[equippedSkillId] : null
    const activeSkill =
      candidateSkill && candidateSkill.classId === selectedClassId && characterLevel >= candidateSkill.requiredLevel
        ? candidateSkill
        : null
    const attackIntervalMs = activeSkill ? activeSkill.attackIntervalMs : 1000 / derived.attackSpeed

    // Account-wide Achievements combat buffs (2026-08-06, Achievements
    // rework; both made per-zone/quality-only 2026-08-07 — attack bonus was
    // a flat account-wide number applying to every fight, which was never
    // the intent) — PREDICTIVE ONLY, same caveat as the rest of this file's
    // kill-branch numbers: mirrors resolve-combat's own accountAttackBonusPct
    // /accountDropMultiplier application exactly, so the log/preview stays
    // consistent with what the next server reconciliation will actually
    // confirm. Both bonuses are scoped to whichever zone the
    // currently-fought monster belongs to, not a flat account-wide number.
    const { accountZoneAttackBonusPct, accountZoneDropBonusPct } = usePlayerRecordStore.getState()
    const currentZoneId = zoneIdForMonster(state.monsterTypeId)
    const accountAttackBonusPct = currentZoneId ? (accountZoneAttackBonusPct[currentZoneId] ?? 0) : 0
    const zoneDropBonusPct = currentZoneId ? (accountZoneDropBonusPct[currentZoneId] ?? 0) : 0
    const accountDropMultiplier = 1 + zoneDropBonusPct / 100
    // Gold Donation Event's active buff (2026-08-29, see
    // CLAUDE.server-events.md) — PREDICTIVE ONLY like the rest of this
    // block, mirrors resolve-combat/index.ts's own eventCometMultiplier/
    // eventFallenStarMultiplier derivation exactly (its 'exp' category no
    // longer has a client-side consumer now that reward-on-kill removed
    // per-attack EXP prediction entirely — see the comment further down).
    // 'quality_tier' has no client mirror (see combatResolver.ts's own
    // note — this predictive path never rolls quality tier at all), so
    // there's no equivalent multiplier to derive here for that category.
    const activeGoldDonationEvent = getActiveGoldDonationEvent(useGoldDonationStore.getState().pool, nowMs)
    const eventCometMultiplier = activeGoldDonationEvent?.category === 'comet' ? activeGoldDonationEvent.multiplier : 1
    const eventFallenStarMultiplier =
      activeGoldDonationEvent?.category === 'fallen_star' ? activeGoldDonationEvent.multiplier : 1
    // Composition attack bonus is added in unscaled, after the account-wide
    // attack bonus % — it must not compound with that multiplier (see
    // derivedStats.ts's compositionPhysicalAttackBonus/compositionMagicAttackBonus
    // comment). Split by type (2026-08-26) so Drake/Ember's own socketed gem
    // bonus % can apply last, to the right type, after quality tier and
    // composition are both already folded in — per the user's explicit
    // ordering request.
    const physicalSubtotal = derived.physicalAttack * (1 + accountAttackBonusPct / 100) + derived.compositionPhysicalAttackBonus
    // The active skill's own flat effectDamage folds in here (before Ember's
    // multiplier, same treatment as compositionMagicAttackBonus) rather than
    // being added to attackMidpoint afterward, so a socketed Ember gem still
    // boosts it like any other magic damage.
    const magicSubtotal =
      derived.magicAttack * (1 + accountAttackBonusPct / 100) +
      derived.compositionMagicAttackBonus +
      (activeSkill?.effectDamage ?? 0)
    // While a skill is active, damage is magic-only (drops physicalSubtotal
    // entirely) — see activeSkill's own comment above. With no skill
    // equipped, damage is physical-only (drops magicSubtotal), matching how
    // every other class's own auto-attack already works in practice (2026-11
    // bug fix, requested by the user — Bow/Club/Longsword/Blade have never
    // carried a magic_attack stat at all, so this was already a no-op for
    // them; only Backsword carries both, which made a skill-less Wuxia
    // silently double-dip on both stats at once). This supersedes the
    // original "uniform physical+magic sum for every class, no branching"
    // design (kept when Backsword had no real physical_attack stat yet, to
    // avoid a skill-less Wuxia dealing 0 damage) — Backsword's
    // physical_attack was given real reference-sourced values in the
    // 2026-10-17 retune, so that concern no longer applies.
    const attackMidpoint = activeSkill
      ? magicSubtotal * (1 + derived.emberBonusPct / 100)
      : physicalSubtotal * (1 + derived.drakeBonusPct / 100)

    // Lazy-init the player's HP the first time combat ever ticks (0/0 sentinel —
    // see the CombatState field comments) rather than resetting it on every
    // start(), so it stays continuous across monster respawns/zone switches.
    const maxPlayerHp = derived.hp
    const currentPlayerHp = state.maxPlayerHp <= 0 ? maxPlayerHp : Math.min(state.currentPlayerHp, maxPlayerHp)
    // Same lazy-init shape for MP (see the CombatState.currentPlayerMp comment).
    const maxPlayerMp = derived.mp
    const currentPlayerMp = state.maxPlayerMp <= 0 ? maxPlayerMp : Math.min(state.currentPlayerMp, maxPlayerMp)

    // Monster attack-back — independent cooldown/cadence from the player's own
    // attack below (PLACEHOLDER: fixed once-per-second, no monster "attack speed"
    // concept exists yet). Checked every tick regardless of whether the player's
    // own attack is on cooldown this tick, so it doesn't end up implicitly synced
    // to the player's attack speed.
    if (nowMs - state.lastMonsterAttackAt >= MONSTER_ATTACK_INTERVAL_MS) {
      // Dodge (see combatResolver.ts's rollIsHit) — a fully-avoided attack, using
      // boots' dodge stat + Agility. If it lands, physicalDefense (necklace/hat/
      // coat) mitigates it the same way monster Defense mitigates the player's
      // own outgoing damage.
      if (!rollIsHit(derived.dodge)) {
        set((s) => ({
          lastMonsterAttackAt: nowMs,
          currentPlayerHp,
          maxPlayerHp,
          currentPlayerMp,
          maxPlayerMp,
          log: appendLog(s.log, { kind: 'dodge', message: `You dodge ${type.displayName}'s attack!` }),
        }))
      } else {
        // Level-gap Defense debuff (see playerDefenseMultiplierForLevelDiff)
        // — a monster that outlevels the character (Red/Black) bypasses more
        // of the player's own physicalDefense, making it "hit a lot harder"
        // per the user's own framing, rather than a flat Attack-minus-Defense
        // regardless of how mismatched the fight actually is.
        const effectivePlayerDefense = Math.round(
          derived.physicalDefense * playerDefenseMultiplierForLevelDiff(characterLevel, type.level),
        )
        // Enchantress "Bless" tab (see gemCatalog.ts's BLESS_PCT_STEPS) —
        // applied after Defense mitigation, not folded into it (Bless is a
        // gear-enchant bonus, not a Defense stat).
        const damage = applyDamageReduction(
          resolvePhysicalDamage(monsterAttackDamage(type), effectivePlayerDefense) *
            deepBlackDamageMultiplier(characterLevel, type.level),
          derived.damageReductionPct,
        )
        const nextPlayerHp = Math.max(0, currentPlayerHp - damage)

        set((s) => ({
          lastMonsterAttackAt: nowMs,
          currentPlayerHp: nextPlayerHp,
          maxPlayerHp,
          currentPlayerMp,
          maxPlayerMp,
          log: appendLog(s.log, {
            kind: 'player-damage',
            message: `${type.displayName} hits you for ${damage}.`,
            amount: damage,
          }),
        }))

        if (nextPlayerHp <= 0) {
          // Knocked out — a death timer (see CombatState.reviveAt and
          // KNOCKOUT_LOCKOUT_MS above), confirmed with the user 2026-08-05,
          // replacing the earlier instant-full-heal-and-stop placeholder.
          // Neither side can act until it elapses; the monster's own
          // currentHp/maxHp are deliberately left untouched here (not
          // reset/respawned), so the fight resumes exactly where it left off
          // once the player revives.
          set((s) => ({
            reviveAt: nowMs + KNOCKOUT_LOCKOUT_MS,
            log: appendLog(s.log, { kind: 'knockout', message: 'You were knocked out! Recovering for 10s...' }),
          }))
          return
        }
      }
    } else if (
      state.maxPlayerHp !== maxPlayerHp ||
      state.currentPlayerHp !== currentPlayerHp ||
      state.maxPlayerMp !== maxPlayerMp ||
      state.currentPlayerMp !== currentPlayerMp
    ) {
      // Only write when something actually changed (lazy-init, or maxPlayerHp/
      // maxPlayerMp shifting from a level-up/gear change) — avoids re-rendering
      // every 100ms tick for no reason, preserving the "on-cooldown ticks are
      // simply dropped" behavior the player's own attack-cooldown check below
      // relies on.
      set({ currentPlayerHp, maxPlayerHp, currentPlayerMp, maxPlayerMp })
    }

    // On-cooldown ticks are simply dropped, not queued — same behavior as the old
    // isometric scene's attack-speed gating.
    if (nowMs - state.lastAttackAt < attackIntervalMs) {
      return
    }

    // Hunter must have the Quiver equipped to attack at all (confirmed with
    // the user, 2026-07-31 — supersedes the earlier ammo-stack/consumption
    // model entirely). No count, no consumption — equipped or not is the
    // whole gate. lastAttackAt still advances on a blocked attempt so it
    // respects the cooldown instead of re-checking (and re-flashing the
    // warning) every tick.
    if (selectedClassId === 'hunter' && !useEquipmentStore.getState().equippedIds.quiver) {
      useNoQuiverWarningStore.getState().trigger()
      set((s) => ({
        lastAttackAt: nowMs,
        log: appendLog(s.log, { kind: 'no-quiver', message: 'No quiver equipped!' }),
      }))
      return
    }

    // An active skill needs enough MP to cast — same "blocked attempt still
    // advances lastAttackAt" shape as the Quiver gate above (respects the
    // cooldown instead of re-checking, and re-logging, every 100ms tick).
    // No fallback to a plain physical attack when out of MP — the attack is
    // simply skipped until a Mana potion restores enough (see
    // restorePlayerMp), matching this game's existing "no auto-resolution,
    // the player deals with it" precedent (no-quiver works the same way).
    // Any outstanding pendingMpAdjustment (see its own field comment) shaves
    // straight off this cast's real cost rather than being snapped onto the
    // display separately — so a player sitting right at their last point of
    // real MP with a small giveback still pending isn't wrongly blocked here.
    const effectiveMpCost = activeSkill ? Math.max(0, activeSkill.mpCost - state.pendingMpAdjustment) : 0

    if (activeSkill && currentPlayerMp < effectiveMpCost) {
      set((s) => ({
        lastAttackAt: nowMs,
        log: appendLog(s.log, { kind: 'no-mana', message: `Not enough Mana to cast ${activeSkill.displayName}!` }),
      }))
      return
    }

    // Mana is spent on the cast attempt itself (hit or miss), not only on a
    // landed hit — matches how the wiki's own "Cost" column reads (a cast
    // cost, not a per-damage cost).
    const nextPlayerMp = activeSkill ? currentPlayerMp - effectiveMpCost : currentPlayerMp
    const nextPendingMpAdjustment = activeSkill
      ? state.pendingMpAdjustment - (activeSkill.mpCost - effectiveMpCost)
      : state.pendingMpAdjustment

    // Reward-on-kill (2026-11, requested by the user — see resolve-combat/
    // index.ts's own rewrite) — the client no longer predicts gold/EXP ahead
    // of the server at all. This used to call expectedRewardPerAttack/
    // addPredictedRewards every tick for a smooth, continuously-climbing
    // estimate; now the displayed value only ever advances when a real
    // server reconciliation confirms a completed kill, which the user
    // explicitly preferred over the old "smooth but sometimes visibly
    // corrects itself" feel — a brief, expected pause after a kill lands
    // rather than continuous prediction.
    const expMultiplier = expMultiplierForLevelDiff(characterLevel, type.level)

    // Outgoing hit-chance roll (2026-08-02, confirmed design) — the reverse of
    // the incoming dodge check below: monsters now have a real Dodge stat
    // (see combatResolver.ts's monsterDodge), so the player's own attacks can
    // miss too. Uses derived.dexterity — a separate stat from derived.dodge
    // (Boots' own evasion stat vs. Bows'/Rings' own accuracy stat, both fed
    // by the same Agility attribute but boosted independently by gear).
    // Magic attacks (activeSkill window) always land — dodge only ever
    // applies to physical attacks (2026-11-25, requested by the user).
    if (!activeSkill && !rollAttackLands(derived.dexterity, monsterDodge(type))) {
      set((s) => ({
        lastAttackAt: nowMs,
        currentPlayerMp: nextPlayerMp,
        pendingMpAdjustment: nextPendingMpAdjustment,
        log: appendLog(s.log, { kind: 'miss', message: `Your attack misses ${type.displayName}!` }),
      }))
      return
    }

    // Simplified Attack-minus-Defense formula (see combatResolver.ts) — closes
    // the previous "Wuxia deals 0 damage" gap by summing physical + magic
    // attack rather than reading physicalAttack alone. Attack is now a rolled
    // min/max range (see rollDamageInRange), not a flat number, off
    // attackMidpoint (already scaled by the account attack buff above).
    // monsterDefense now also takes characterLevel (level-gap Defense
    // debuff, 2026-08-05). Magic attacks (activeSkill window) mitigate
    // against monsterMagicDefense instead of the physical-only monsterDefense
    // (2026-11 bug fix — see that function's own comment).
    const rawDamage = resolvePhysicalDamage(
      rollDamageInRange(attackMidpoint),
      activeSkill ? monsterMagicDefense(type, characterLevel) : monsterDefense(type, characterLevel),
    )
    // Fold in any small pending correction from the last resolve-combat sync
    // (v1.123.3, see pendingHpAdjustment's own field comment) into this
    // hit's own damage instead of snapping the bar on its own — positive
    // pending means the real monster has more HP than shown (this hit does
    // less), negative means less (this hit does more). Clamped so a large
    // pending can never show as a healing/negative hit — it just absorbs as
    // much as this one hit safely can.
    const damage = Math.max(1, Math.round(rawDamage - state.pendingHpAdjustment))
    const nextHp = Math.max(0, state.currentHp - damage)

    set((s) => ({
      lastAttackAt: nowMs,
      currentHp: nextHp,
      currentPlayerMp: nextPlayerMp,
      pendingHpAdjustment: 0,
      pendingMpAdjustment: nextPendingMpAdjustment,
      log: appendLog(s.log, { kind: 'damage', message: `You hit ${type.displayName} for ${damage}.`, amount: damage }),
    }))

    if (nextHp <= 0) {
      // Gold/EXP in this log line are still the old RNG-flavor numbers, kept
      // purely for the "kill moment" celebratory text — no client prediction
      // is fed by this at all now (see the reward-on-kill comment above);
      // the real grant only ever comes from the next server reconciliation.
      const { gold, exp } = killRewards(type, state.isRareInstance, expMultiplier)
      // See killsTowardRare's own field comment — this confirms the kill
      // just landed counts as kill number (state.killsTowardRare + 1),
      // advancing the cadence for whatever spawns next.
      const nextKillsTowardRare = state.killsTowardRare + 1

      set((s) => ({
        killsTowardRare: nextKillsTowardRare,
        log: appendLog(s.log, {
          kind: state.isRareInstance ? 'rare-kill' : 'kill',
          message: state.isRareInstance
            ? `Rare ${type.displayName} defeated! +${gold} Gold, +${exp} EXP`
            : `${type.displayName} defeated! +${gold} Gold, +${exp} EXP`,
        }),
      }))

      // No longer scaled by accountDropMultiplier (2026-08-07) — the zone
      // drop bonus only affects quality-tier odds now, not whether a drop
      // happens at all, and this predictive path never shows/rolls quality
      // anyway (see useInventoryStore.rollItemDrop's own comment).
      const drop = useInventoryStore.getState().rollItemDrop(type.level)
      if (drop) {
        set((s) => ({
          log: appendLog(s.log, { kind: 'item', message: `You found: ${drop.template.name}` }),
        }))
      }

      const bonusCurrency = rollBonusCurrencyDrops(
        accountDropMultiplier * eventCometMultiplier,
        accountDropMultiplier * eventFallenStarMultiplier,
      )
      if (bonusCurrency.comets > 0 || bonusCurrency.fallenStars > 0) {
        const parts = [
          bonusCurrency.comets > 0 ? `+${bonusCurrency.comets} Comet` : null,
          bonusCurrency.fallenStars > 0 ? `+${bonusCurrency.fallenStars} Fallen Star` : null,
        ].filter((part): part is string => part !== null)
        set((s) => ({
          log: appendLog(s.log, { kind: 'currency', message: `You found: ${parts.join(', ')}` }),
        }))
      }

      if (rollJadeShardDrop(type.id)) {
        set((s) => ({
          log: appendLog(s.log, { kind: 'item', message: 'You found: Jade Shard' }),
        }))
      }

      // Respawn gap (see RESPAWN_GAP_MS/currentMonsterSpawnedAt) — runs
      // concurrently with the fight from the moment this monster spawned,
      // not additively from the kill (2026-11, requested by the user). If
      // the fight already ran longer than the gap, spawn the next instance
      // immediately (no visible waiting state); otherwise fall back to the
      // same waiting-state shape as before, just for whatever's left of the
      // gap rather than a fresh full RESPAWN_GAP_MS.
      const respawnEligibleAt = state.currentMonsterSpawnedAt + RESPAWN_GAP_MS
      if (nowMs >= respawnEligibleAt) {
        const nextIsRare = isRareKillNumber(nextKillsTowardRare + 1)
        const nextHpValue = spawnMonsterHp(type, nextIsRare)
        set((s) => ({
          currentHp: nextHpValue,
          maxHp: nextHpValue,
          isRareInstance: nextIsRare,
          monsterInstanceKey: s.monsterInstanceKey + 1,
          currentMonsterSpawnedAt: nowMs,
          lastAttackAt: nowMs,
          lastMonsterAttackAt: nowMs,
          lastKillSignal: s.lastKillSignal + 1,
          pendingHpAdjustment: 0,
          log: appendLog(
            s.log,
            nextIsRare
              ? { kind: 'engage', message: `A rare ${type.displayName} appears!` }
              : { kind: 'engage', message: `A new ${type.displayName} appears.` },
          ),
        }))
      } else {
        set((s) => ({
          currentHp: 0,
          maxHp: 0,
          respawnReadyAt: respawnEligibleAt,
          lastKillSignal: s.lastKillSignal + 1,
          pendingHpAdjustment: 0,
        }))
      }
    }
  },

  healPlayerHp: (amount) => {
    set((state) => {
      if (state.maxPlayerHp <= 0) {
        return {}
      }
      return { currentPlayerHp: Math.min(state.maxPlayerHp, state.currentPlayerHp + amount) }
    })
  },

  restorePlayerMp: (amount) => {
    set((state) => {
      if (state.maxPlayerMp <= 0) {
        return {}
      }
      return { currentPlayerMp: Math.min(state.maxPlayerMp, state.currentPlayerMp + amount) }
    })
  },

  syncPlayerMp: (amount) => {
    set((state) => {
      if (state.maxPlayerMp <= 0) {
        return {}
      }
      const clamped = Math.min(state.maxPlayerMp, Math.max(0, amount))
      const delta = clamped - state.currentPlayerMp
      // A shortfall (server confirms less remaining than shown) applies
      // immediately — mana dropping further mid-fight is already expected,
      // nothing to smooth. A surplus (see pendingMpAdjustment's own field
      // comment) is deferred instead of snapped, so it reads as the next
      // cast or two landing slightly cheaper rather than the bar visibly
      // refilling on its own.
      if (delta > 0) {
        return { pendingMpAdjustment: state.pendingMpAdjustment + delta }
      }
      return { currentPlayerMp: clamped }
    })
  },

  syncMonsterInstance: (instance, serverNowMs) => {
    set((state) => {
      const monsterTypeId = state.monsterTypeId
      if (!state.isFighting || !monsterTypeId || monsterTypeId !== instance.monster_id) {
        return {}
      }
      const type = ENEMY_TYPES[monsterTypeId]

      // Clock-skew correction (bug fix reported by the user — the respawn
      // countdown jumped to a nonsensical value on every sync, traced to a
      // client device clock running seconds off from the server). instance's
      // spawned_at/respawn_at are absolute timestamps from the SERVER's
      // clock; adding this offset re-expresses each one as "that many ms
      // from now" using the CLIENT's own Date.now(), so a skewed device
      // clock can never leak into the countdown or into runTick's own
      // respawn-timing check (both compare against Date.now() elsewhere).
      const clockCorrectionMs = Date.now() - serverNowMs
      const toClientMs = (iso: string) => new Date(iso).getTime() + clockCorrectionMs

      // Anti-regression ordering (v1.123.3, bug fix reported by the user —
      // "I watch the enemy die and a new one spawn but then it rubber-bands
      // back to the low-health enemy"). Both currentMonsterSpawnedAt (this
      // tab's own local walk) and instance.spawned_at/respawn_at (resolve-
      // combat's own independent walk) are just "the latest spawn moment
      // each side's simulation has reached so far," progressing over the
      // same shared real elapsed time — even though the two sides are
      // tracking different specific (independently rolled) instances, that
      // makes comparing them a meaningful proxy for "has my own display
      // already progressed further in real time than what this response
      // describes." The dead/waiting branch has no spawned_at of its own
      // (nulled whenever hp<=0) — reconstruct it from respawn_at, which the
      // server always sets as spawnedAt + RESPAWN_GAP_MS for a dead instance.
      const impliedSpawnedAtMs =
        instance.hp > 0
          ? instance.spawned_at
            ? toClientMs(instance.spawned_at)
            : null
          : instance.respawn_at
            ? toClientMs(instance.respawn_at) - RESPAWN_GAP_MS
            : null

      // Only a genuine invariant violation (documented in resolve-combat's
      // own comment) reaches here with no timestamp to order against at all
      // — fail open (apply immediately) rather than get stuck, same as the
      // pre-v1.123.3 behavior.
      if (impliedSpawnedAtMs !== null && impliedSpawnedAtMs < state.currentMonsterSpawnedAt) {
        return {}
      }

      // "Same" real fight moment is a tolerance window, not exact equality —
      // two fully independent simulations landing on the exact same
      // millisecond would essentially never happen by chance, which would
      // make the diffusion path below dead code. Anything within half a
      // respawn gap counts as "still describing the fight currently on
      // screen" (timing/latency noise between the two sides, not a genuinely
      // different kill generation) — guaranteed not to straddle two real
      // kills, since consecutive real spawns are always >= RESPAWN_GAP_MS
      // apart.
      const isSameFightMoment =
        impliedSpawnedAtMs !== null && Math.abs(impliedSpawnedAtMs - state.currentMonsterSpawnedAt) <= RESPAWN_GAP_MS / 2

      if (instance.hp > 0) {
        // Same real fight moment, same rare-ness — small drift gets diffused
        // into the next real hit instead of snapping the bar on its own
        // (v1.123.3 Part 3). A rare-vs-normal mismatch at the same moment is
        // a different, larger kind of disagreement (still a known, disclosed
        // gap — see CLAUDE.combat-and-loot.md) — falls through to a hard
        // snap below, same as before.
        if (isSameFightMoment && instance.is_rare === state.isRareInstance) {
          const discrepancy = instance.hp - state.currentHp
          const netPending = state.pendingHpAdjustment + discrepancy
          const diffuseCap = state.maxHp * 0.1
          if (Math.abs(netPending) <= diffuseCap) {
            return { pendingHpAdjustment: netPending }
          }
          // Accumulated past the point of plausibly hiding inside one hit —
          // hard-set instead of letting it grow further.
          return {
            monsterInstanceKey: state.monsterInstanceKey + 1,
            currentHp: Math.max(1, Math.round(instance.hp)),
            pendingHpAdjustment: 0,
          }
        }

        return {
          monsterInstanceKey: state.monsterInstanceKey + 1,
          // resolve-combat's own hp is real, unrounded floating-point math
          // (fractional damage-per-ms accumulation) — the client's own local
          // sim always dealt whole-number damage (resolvePhysicalDamage
          // rounds), so currentHp has always been an integer everywhere else
          // this store touches it. Round here, at the one place a raw server
          // value enters this field, rather than teaching every display site
          // to defensively round (bug: the HP bar briefly showed
          // "369.6199785156251 / 684 HP" without this).
          currentHp: Math.max(1, Math.round(instance.hp)),
          maxHp: spawnMonsterHp(type, instance.is_rare),
          isRareInstance: instance.is_rare,
          currentMonsterSpawnedAt: impliedSpawnedAtMs ?? Date.now(),
          respawnReadyAt: 0,
          pendingHpAdjustment: 0,
        }
      }

      // Dead, waiting out the real respawn gap (or already past it — a null
      // respawn_at here would be a resolve-combat invariant violation, but
      // falls back to "spawn on the very next tick" rather than a stuck
      // fight if it ever happens).
      return {
        monsterInstanceKey: state.monsterInstanceKey + 1,
        currentHp: 0,
        maxHp: 0,
        pendingHpAdjustment: 0,
        respawnReadyAt: instance.respawn_at ? toClientMs(instance.respawn_at) : Date.now(),
      }
    })
  },

  syncKillsTowardRare: (monsterId, confirmedCount) => {
    set((state) => {
      if (state.monsterTypeId !== monsterId || confirmedCount <= state.killsTowardRare) {
        return {}
      }
      return { killsTowardRare: confirmedCount }
    })
  },

  stopForInventoryFull: () =>
    set((state) => ({
      isFighting: false,
      log: appendLog(state.log, {
        kind: 'inventory-full',
        message: 'Inventory is full — combat stopped. Clear some space to keep fighting.',
      }),
    })),

  logPetObtained: (monsterName) =>
    set((state) => ({
      log: appendLog(state.log, {
        kind: 'pet',
        message: `You obtained the ${monsterName} pet!`,
      }),
    })),

  isKnockedOutAt: (nowMs) => {
    const state = get()
    if (state.reviveAt <= 0) return false
    if (nowMs < state.reviveAt) return true
    set((s) => ({
      reviveAt: 0,
      currentPlayerHp: s.maxPlayerHp,
      log: appendLog(s.log, { kind: 'knockout', message: 'You revive and rejoin the fight!' }),
    }))
    return true
  },

  applyIncomingDamage: (damage, nowMs, sourceName) => {
    set((state) => {
      if (state.reviveAt > 0 || state.maxPlayerHp <= 0) return {}
      const nextHp = Math.max(0, state.currentPlayerHp - damage)
      if (nextHp <= 0) {
        return {
          currentPlayerHp: 0,
          reviveAt: nowMs + KNOCKOUT_LOCKOUT_MS,
          log: appendLog(state.log, { kind: 'knockout', message: 'You were knocked out! Recovering for 10s...' }),
        }
      }
      return {
        currentPlayerHp: nextHp,
        log: appendLog(state.log, {
          kind: 'player-damage',
          message: `${sourceName} hits you for ${damage}.`,
          amount: damage,
        }),
      }
    })
  },
}))
