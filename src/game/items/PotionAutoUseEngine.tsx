import { useEffect } from 'react'
import { useCombatStore } from '../combat/useCombatStore'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useVipAutomationStore } from '../vip/useVipAutomationStore'
import { usePotionStore } from './usePotionStore'
import { findBestPotionStack } from './potionSelectors'
import { HP_POTION_ORDER, MP_POTION_ORDER } from './potionTypes'

// Auto-drinks the best owned HP/Mana potion once that pool drops below 30%
// of max, for VIP accounts with the matching useVipAutomationStore toggle on
// (see the Inventory potion row's Auto button) — live play only. The
// resolve-combat Deno mirror handles Mana the same way for offline/AFK play
// (current_mp is a real persisted number there); HP has no continuous value
// server-side (only knockout-or-not, see that file's own comment), so HP
// auto-use only ever runs here, while a tab is actually open and
// useCombatStore's currentPlayerHp is actively ticking.
//
// Non-visual, mounted unconditionally in GameShell (same shape as
// VipAutomationEngine). usePotionStore.usePotion() already updates its own
// stacks optimistically (and heals currentPlayerHp/currentPlayerMp)
// synchronously before its RPC await, so re-running this check on every
// render correctly sees the post-drink state immediately rather than racing
// itself — no debounce needed, unlike VipAutomationEngine's inventory pass.
const AUTO_USE_THRESHOLD_FRACTION = 0.3

export default function PotionAutoUseEngine() {
  const currentPlayerHp = useCombatStore((state) => state.currentPlayerHp)
  const maxPlayerHp = useCombatStore((state) => state.maxPlayerHp)
  const currentPlayerMp = useCombatStore((state) => state.currentPlayerMp)
  const maxPlayerMp = useCombatStore((state) => state.maxPlayerMp)
  const reviveAt = useCombatStore((state) => state.reviveAt)
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const autoUsePotions = useVipAutomationStore((state) => state.settings.autoUsePotions)
  const potionStacks = usePotionStore((state) => state.stacks)
  // Named handleX, not usePotion — eslint's rules-of-hooks treats any
  // identifier starting with "use" as a hook, which would wrongly flag the
  // plain calls to it below (same naming workaround InventoryPanel.tsx's
  // own handleUseVipToken/consumeExperienceOrb already use).
  const handleUsePotion = usePotionStore((state) => state.usePotion)

  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())

  useEffect(() => {
    if (!isVipActive) {
      return
    }

    // Knocked out — no live HP to top up until revive (mirrors
    // applyIncomingDamage's own reviveAt > 0 guard).
    if (autoUsePotions.hp && maxPlayerHp > 0 && reviveAt <= 0 && currentPlayerHp / maxPlayerHp < AUTO_USE_THRESHOLD_FRACTION) {
      const stack = findBestPotionStack(potionStacks, HP_POTION_ORDER)
      if (stack) {
        void handleUsePotion(stack.id)
        return
      }
    }

    if (autoUsePotions.mp && maxPlayerMp > 0 && currentPlayerMp / maxPlayerMp < AUTO_USE_THRESHOLD_FRACTION) {
      const stack = findBestPotionStack(potionStacks, MP_POTION_ORDER)
      if (stack) {
        void handleUsePotion(stack.id)
      }
    }
  }, [
    isVipActive,
    autoUsePotions.hp,
    autoUsePotions.mp,
    currentPlayerHp,
    maxPlayerHp,
    currentPlayerMp,
    maxPlayerMp,
    reviveAt,
    potionStacks,
    handleUsePotion,
  ])

  return null
}
