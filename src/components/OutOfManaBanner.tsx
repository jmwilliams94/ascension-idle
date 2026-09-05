import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCombatStore } from '../game/combat/useCombatStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useSkillsStore } from '../game/skills/useSkillsStore'
import { SKILL_TYPES } from '../game/skills/skillData'
import { useAppUpdateStore } from '../lib/useAppUpdateStore'

// Dismissable top-of-screen banner shown while an equipped active skill (only
// Wuxia's Thunder exists as of 2026-11, see skillData.ts) is blocked from
// casting because currentPlayerMp has dropped below its mpCost — the same
// gate useCombatStore.runTick itself applies (see its own 'no-mana' log
// line), just surfaced somewhere more visible than the combat log so a
// player isn't left wondering why their attacks stopped landing. Same
// fixed/border-b/backdrop-blur "glass" bar as UpdateBanner.tsx/
// GoldDonationBuffBanner.tsx, in the MP bar's own sky-500 (see CombatPage.tsx's
// HpBar barColorClass) instead of amber/emerald.
//
// Mounted after GoldDonationBuffBanner in GameShell so it paints on top if
// both happen to be true at once (same "one always wins the slot, no
// stacking" precedent GoldDonationBuffBanner itself set against
// UpdateBanner) — an active-skill mana block is a real gameplay blocker,
// outranking a buff-info banner.
//
// dismissedAtEpisode tracks whether THIS continuous out-of-mana episode was
// already dismissed (mirrors GoldDonationBuffBanner's dismissedKey, just
// keyed by transition-into-true since there's no natural end timestamp here
// — MP only comes back up via a Mana potion, not a clock) so drinking a
// potion and later running dry again re-shows the banner instead of staying
// dismissed forever.
export default function OutOfManaBanner() {
  const needRefresh = useAppUpdateStore((state) => state.needRefresh)
  const currentPlayerMp = useCombatStore((state) => state.currentPlayerMp)
  const maxPlayerMp = useCombatStore((state) => state.maxPlayerMp)
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const level = useProgressionStore((state) => state.level)
  const equippedSkillId = useSkillsStore((state) => state.equippedSkillId)
  const [dismissed, setDismissed] = useState(false)
  const wasOutOfMana = useRef(false)

  const candidateSkill = equippedSkillId ? SKILL_TYPES[equippedSkillId] : null
  const activeSkill =
    candidateSkill && candidateSkill.classId === selectedClassId && level >= candidateSkill.requiredLevel
      ? candidateSkill
      : null
  const isOutOfMana = activeSkill !== null && maxPlayerMp > 0 && currentPlayerMp < activeSkill.mpCost

  useEffect(() => {
    if (isOutOfMana && !wasOutOfMana.current) {
      setDismissed(false)
    }
    wasOutOfMana.current = isOutOfMana
  }, [isOutOfMana])

  if (needRefresh || !isOutOfMana || dismissed) {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-sky-500/50 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-200 backdrop-blur"
      style={{ transform: 'translateZ(0)' }}
    >
      <span>Out of Mana — {activeSkill?.displayName} is disabled until you restore MP.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/20"
      >
        Dismiss
      </button>
    </div>,
    document.body,
  )
}
