import { useState } from 'react'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useForgeStore } from '../game/items/useForgeStore'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

const MAX_SOCKETS = 2
const ARMOR_SLOT_TYPES = ['ring', 'necklace', 'boots', 'hat', 'coat']

function describeUnlockFailure(error?: string): string {
  switch (error) {
    case 'not_enough_fallen_stars':
      return 'Not enough Fallen Stars.'
    case 'not_enough_room_to_unbundle':
      return "Would need to unbundle a Scroll for this, but there's no Inventory room for it."
    case 'max_sockets':
      return 'Already has the max 2 sockets.'
    case 'not_a_weapon':
      return "This item can't take a purchased socket."
    default:
      return 'Something went wrong.'
  }
}

// Sockets tab (2026-08-02) — see CLAUDE.md's Sockets section for the
// confirmed, asymmetric-by-item-type design this implements: weapons get a
// guaranteed, player-paid unlock (1 Fallen Star for the first, 5 for the
// second); armor instead gets a small RNG chance to gain one as a side
// effect of a Quality or Level Upgrade (see quality_upgrade/level_upgrade's
// own socket-roll logic — there's nothing to click for that case, this tab
// is informational only). Either way, an unlocked socket just shows Empty —
// gems aren't implemented as items yet, so nothing can ever fill one.
export default function ForgeSocketsPanel({ item, template }: { item: ItemInstance; template: ItemTemplate | null }) {
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const busy = useForgeStore((state) => state.busy)
  const unlockWeaponSocket = useForgeStore((state) => state.unlockWeaponSocket)
  const [error, setError] = useState<string | null>(null)

  const socketCount = item.sockets.length
  const isWeapon = template?.slot_type === 'weapon'
  const isArmor = template ? ARMOR_SLOT_TYPES.includes(template.slot_type) : false
  const maxed = socketCount >= MAX_SOCKETS
  const cost = socketCount === 0 ? 1 : 5

  const handleUnlock = async () => {
    setError(null)
    const result = await unlockWeaponSocket(item.id)
    if (!result.ok) {
      setError(describeUnlockFailure(result.error))
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-600">Sockets</p>
        {socketCount === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No sockets yet.</p>
        ) : (
          <div className="mt-1 flex gap-1.5">
            {item.sockets.map((socket, index) => (
              <div
                key={index}
                className="flex h-9 flex-1 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/60 text-[10px] text-slate-500"
              >
                {socket ? 'Filled' : 'Empty'}
              </div>
            ))}
          </div>
        )}
      </div>

      {isWeapon && (
        <>
          {maxed ? (
            <p className="text-center text-[10px] text-slate-500">Both sockets unlocked.</p>
          ) : (
            <button
              type="button"
              disabled={busy || fallenStars < cost}
              onClick={() => void handleUnlock()}
              title={fallenStars < cost ? `Need ${cost} Fallen Star${cost === 1 ? '' : 's'} (have ${fallenStars}).` : undefined}
              className="w-full rounded-lg border border-emerald-600 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : `Unlock Socket ${socketCount + 1} (${cost} Fallen Star${cost === 1 ? '' : 's'})`}
            </button>
          )}
        </>
      )}

      {isArmor && (
        <p className="text-center text-[10px] text-slate-500">
          Armor sockets aren't purchased — there's a small chance (~1%) to gain one automatically whenever you Quality or Level
          Upgrade this item. {socketCount}/{MAX_SOCKETS} unlocked.
        </p>
      )}

      {!isWeapon && !isArmor && <p className="text-center text-[10px] text-slate-500">This item doesn't support sockets.</p>}

      {error && <p className="text-center text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
