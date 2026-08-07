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
import { ENEMY_TYPES, zoneIdForMonster, type EnemyTypeId } from '../zones/zoneData'
import {
  MONSTER_ATTACK_INTERVAL_MS,
  RARE_REWARD_MULTIPLIER,
  damageExpForHit,
  expMultiplierForLevelDiff,
  killRewards,
  monsterAttackDamage,
  monsterDefense,
  monsterDodge,
  playerDefenseMultiplierForLevelDiff,
  resolvePhysicalDamage,
  rollAttackLands,
  rollBonusCurrencyDrops,
  rollDamageInRange,
  rollIsHit,
  rollIsRare,
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
  // The player's own HP — continuous across monster respawns/zone switches (only
  // reset by a knockout, not by start()/stop()/clear()), unlike the monster's own
  // currentHp/maxHp above. 0/0 is a sentinel meaning "never initialized yet";
  // runTick lazily fills both in from derived.hp the first time it ticks.
  currentPlayerHp: number
  maxPlayerHp: number
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
}

export const useCombatStore = create<CombatState>((set, get) => ({
  isFighting: false,
  monsterTypeId: null,
  monsterInstanceKey: 0,
  currentHp: 0,
  maxHp: 0,
  isRareInstance: false,
  currentPlayerHp: 0,
  maxPlayerHp: 0,
  reviveAt: 0,
  log: [],
  lastAttackAt: 0,
  lastMonsterAttackAt: 0,

  start: (monsterTypeId) => {
    const type = ENEMY_TYPES[monsterTypeId]
    const isRare = rollIsRare()
    const hp = spawnMonsterHp(type, isRare)

    set((state) => ({
      isFighting: true,
      monsterTypeId,
      monsterInstanceKey: state.monsterInstanceKey + 1,
      currentHp: hp,
      maxHp: hp,
      isRareInstance: isRare,
      lastAttackAt: 0,
      lastMonsterAttackAt: 0,
      // Clears any stale death-timer lockout from before a manual Stop —
      // starting a fresh fight should never inherit an old incapacitation.
      reviveAt: 0,
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

    const type = ENEMY_TYPES[state.monsterTypeId]
    const { selectedClassId, attributes } = useCharacterStore.getState()
    const characterLevel = useProgressionStore.getState().level
    const equipmentBonus = computeEquipmentBonus(
      useEquipmentStore.getState().equippedIds,
      useInventoryStore.getState().items,
      useItemTemplatesStore.getState().templates,
    )
    const derived = computeDerivedStats(attributes, equipmentBonus)
    const attackIntervalMs = 1000 / derived.attackSpeed

    // Account-wide Achievements combat buffs (2026-08-06, Achievements
    // rework; drop bonus made per-zone/quality-only 2026-08-07) — PREDICTIVE
    // ONLY, same caveat as the rest of this file's kill-branch numbers:
    // mirrors resolve-combat's own accountAttackBonusPct/accountDropMultiplier
    // application exactly, so the log/preview stays consistent with what the
    // next server reconciliation will actually confirm. The drop bonus is
    // now scoped to whichever zone the currently-fought monster belongs to,
    // not a flat account-wide number.
    const { accountAttackBonusPct, accountZoneDropBonusPct } = usePlayerRecordStore.getState()
    const currentZoneId = zoneIdForMonster(state.monsterTypeId)
    const zoneDropBonusPct = currentZoneId ? (accountZoneDropBonusPct[currentZoneId] ?? 0) : 0
    const accountDropMultiplier = 1 + zoneDropBonusPct / 100
    const attackMidpoint = (derived.physicalAttack + derived.magicAttack) * (1 + accountAttackBonusPct / 100)

    // Lazy-init the player's HP the first time combat ever ticks (0/0 sentinel —
    // see the CombatState field comments) rather than resetting it on every
    // start(), so it stays continuous across monster respawns/zone switches.
    const maxPlayerHp = derived.hp
    const currentPlayerHp = state.maxPlayerHp <= 0 ? maxPlayerHp : Math.min(state.currentPlayerHp, maxPlayerHp)

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
        const damage = resolvePhysicalDamage(monsterAttackDamage(type), effectivePlayerDefense)
        const nextPlayerHp = Math.max(0, currentPlayerHp - damage)

        set((s) => ({
          lastMonsterAttackAt: nowMs,
          currentPlayerHp: nextPlayerHp,
          maxPlayerHp,
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
    } else if (state.maxPlayerHp !== maxPlayerHp || state.currentPlayerHp !== currentPlayerHp) {
      // Only write when something actually changed (lazy-init, or maxPlayerHp
      // shifting from a level-up/gear change) — avoids re-rendering every 100ms
      // tick for no reason, preserving the "on-cooldown ticks are simply dropped"
      // behavior the player's own attack-cooldown check below relies on.
      set({ currentPlayerHp, maxPlayerHp })
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

    // Outgoing hit-chance roll (2026-08-02, confirmed design) — the reverse of
    // the incoming dodge check below: monsters now have a real Dodge stat
    // (see combatResolver.ts's monsterDodge), so the player's own attacks can
    // miss too. Uses derived.dexterity — a separate stat from derived.dodge
    // (Boots' own evasion stat vs. Bows'/Rings' own accuracy stat, both fed
    // by the same Agility attribute but boosted independently by gear).
    if (!rollAttackLands(derived.dexterity, monsterDodge(type))) {
      set((s) => ({
        lastAttackAt: nowMs,
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
    // debuff, 2026-08-05).
    const damage = resolvePhysicalDamage(rollDamageInRange(attackMidpoint), monsterDefense(type, characterLevel))
    const nextHp = Math.max(0, state.currentHp - damage)

    set((s) => ({
      lastAttackAt: nowMs,
      currentHp: nextHp,
      log: appendLog(s.log, { kind: 'damage', message: `You hit ${type.displayName} for ${damage}.`, amount: damage }),
    }))

    // Damage-dealt EXP (2026-08-05, confirmed with the user, matching a real
    // Conquer Online mechanic — see damageExpForHit) — PREDICTIVE ONLY, same
    // caveat as the kill-EXP prediction below. state.maxHp is this specific
    // spawn's own actual max HP (already rare-doubled if applicable), and
    // rareMultiplier mirrors killRewards' own 5x-for-rare scaling so a rare
    // monster's damage-EXP total ends up matching its on-kill reward's own
    // rare bonus — see resolve-combat's own mirror for the full reasoning.
    const expMultiplier = expMultiplierForLevelDiff(useProgressionStore.getState().level, type.level)
    const rareMultiplier = state.isRareInstance ? RARE_REWARD_MULTIPLIER : 1
    useProgressionStore
      .getState()
      .addPredictedRewards(0, Math.round(damageExpForHit(damage, state.maxHp, type.level) * expMultiplier * rareMultiplier))

    if (nextHp <= 0) {
      // PREDICTIVE ONLY — no real grants happen here anymore. gold/EXP/item/
      // currency rewards are now server-authoritative (see resolveCombat.ts /
      // supabase/functions/resolve-combat), applied by a periodic background
      // call (CombatEngine.tsx) rather than instantly per kill. These numbers
      // are shown purely for immediate visual feedback and may not exactly
      // match what the next resolve confirms a few seconds later — the cost
      // of making rewards genuinely server-verified without adding real
      // per-attack network latency to the fighting itself.
      const { gold, exp } = killRewards(type, state.isRareInstance, expMultiplier)
      // Feeds the visible Gold/EXP bar in real time (see ExpBar.tsx) —
      // previously only the log's text updated
      // instantly, while the actual displayed numbers stayed frozen until the
      // next resolve-combat confirmation landed, feeling like a sudden lump-
      // sum jump. Reconciled (reset to 0) by applyServerCombatResult.
      useProgressionStore.getState().addPredictedRewards(gold, exp)

      set((s) => ({
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

      const bonusCurrency = rollBonusCurrencyDrops(accountDropMultiplier)
      if (bonusCurrency.comets > 0 || bonusCurrency.fallenStars > 0) {
        const parts = [
          bonusCurrency.comets > 0 ? `+${bonusCurrency.comets} Comet` : null,
          bonusCurrency.fallenStars > 0 ? `+${bonusCurrency.fallenStars} Fallen Star` : null,
        ].filter((part): part is string => part !== null)
        set((s) => ({
          log: appendLog(s.log, { kind: 'currency', message: `You found: ${parts.join(', ')}` }),
        }))
      }

      // Respawn immediately — no fixed respawn timer like the old isometric scene's
      // killEnemy(), since there's no spatial spawn point to wait for anymore.
      const nextIsRare = rollIsRare()
      const nextHpValue = spawnMonsterHp(type, nextIsRare)

      set((s) => ({
        monsterInstanceKey: s.monsterInstanceKey + 1,
        currentHp: nextHpValue,
        maxHp: nextHpValue,
        isRareInstance: nextIsRare,
        log: appendLog(
          s.log,
          nextIsRare
            ? { kind: 'engage', message: `A rare ${type.displayName} appears!` }
            : { kind: 'engage', message: `A new ${type.displayName} appears.` },
        ),
      }))
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
}))
