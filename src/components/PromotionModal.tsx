import { useState } from 'react'
import BankActionModal from './BankActionModal'
import { Button } from './ui/Button'
import { usePromotionStore, type PromotionCost, type PromotionTier } from '../game/items/usePromotionStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'

const ERROR_MESSAGES: Record<string, string> = {
  not_owner: "Couldn't verify your character.",
  no_further_promotion: 'No further promotion available yet.',
  level_too_low: "You haven't reached the required level yet.",
  cannot_afford: "You don't have everything required.",
  template_missing: 'Something went wrong — try again.',
  not_enough_room: 'Not enough Inventory room for the reward — free up some space and try again.',
  not_enough_room_to_unbundle: "Would need to unbundle a Scroll for this, but there's no Inventory room for it.",
}

function currencyLabel(name: string): string {
  if (name === 'gold') return 'Gold'
  if (name === 'comet') return 'Comet'
  if (name === 'fallen_star') return 'Fallen Star'
  return name
}

function pluralize(label: string, quantity: number): string {
  return quantity === 1 ? label : `${label}s`
}

export default function PromotionModal({
  tier,
  characterId,
  onClose,
}: {
  tier: PromotionTier
  characterId: string
  onClose: () => void
}) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const gold = useProgressionStore((state) => state.gold)
  const comets = useCurrencyStore((state) => state.comets)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const isEquipped = useEquipmentStore((state) => state.isEquipped)
  const busy = usePromotionStore((state) => state.busy)
  const promote = usePromotionStore((state) => state.promote)

  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  // Preview-only — the RPC re-validates everything server-side regardless.
  const ownedCountFor = (cost: PromotionCost): number => {
    if (cost.kind === 'currency') {
      if (cost.name === 'gold') return gold
      if (cost.name === 'comet') return comets
      if (cost.name === 'fallen_star') return fallenStars
      return 0
    }

    const template = templates.find((t) => t.name === cost.name)
    if (!template) return 0
    return items.filter((item) => item.template_id === template.id && item.location !== 'bank' && !isEquipped(item.id)).length
  }

  const canAfford = tier.items_required.every((cost) => ownedCountFor(cost) >= cost.quantity)

  const handleConfirm = async () => {
    const promoteResult = await promote(characterId)
    if (!promoteResult.ok) {
      setResult({ success: false, message: ERROR_MESSAGES[promoteResult.error ?? ''] ?? 'Something went wrong.' })
      return
    }
    setResult({ success: true, message: `Promoted to ${promoteResult.title ?? tier.title}!` })
  }

  return (
    <BankActionModal title={tier.title} subtitle={`Reach level ${tier.level} — Promotion`} onClose={onClose}>
      <div className="space-y-4">
        {tier.items_required.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-300">Requires</p>
            {tier.items_required.map((cost, index) => {
              const owned = ownedCountFor(cost)
              const short = owned < cost.quantity
              const label = cost.kind === 'currency' ? currencyLabel(cost.name) : cost.name
              return (
                <p key={index} className={`text-xs ${short ? 'text-amber-400' : 'text-slate-400'}`}>
                  {label} — {owned}/{cost.quantity}
                </p>
              )
            })}
          </div>
        )}

        {(tier.award_items.length > 0 || tier.skills_unlocked.length > 0) && (
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-300">Rewards</p>
            {tier.award_items.map((award, index) => {
              const label = award.kind === 'currency' ? currencyLabel(award.name) : award.name
              return (
                <p key={index} className="text-xs text-emerald-300">
                  +{award.quantity} {pluralize(label, award.quantity)}
                </p>
              )
            })}
            {tier.skills_unlocked.length > 0 && <p className="text-xs text-slate-400">Unlocks: {tier.skills_unlocked.join(', ')}</p>}
          </div>
        )}

        {result && (
          <div
            className={`rounded-xl border p-3 text-center text-sm ${
              result.success ? 'border-emerald-600 bg-emerald-500/10 text-emerald-300' : 'border-red-800 bg-red-500/10 text-red-300'
            }`}
          >
            {result.message}
          </div>
        )}

        {!result?.success && (
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || !canAfford} onClick={() => void handleConfirm()} className="flex-1">
              {busy ? 'Promoting…' : 'Promote'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}

        {result?.success && (
          <Button variant="secondary" onClick={onClose} className="w-full">
            Close
          </Button>
        )}
      </div>
    </BankActionModal>
  )
}
