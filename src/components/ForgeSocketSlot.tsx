import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { useIsDropTarget } from './dragDropContext'
import { buildGemTooltip, getGemIconSrc, getGemTierColor, parseGemStorageKey, type GemTier, type GemTypeId } from '../game/items/gemTypes'

interface ForgeSocketSlotProps {
  index: number
  // Not yet unlocked (weapon: not purchased; armor: hasn't rolled) — shown as
  // a plain "Locked" tile with no drop-zone at all, so a dragged gem can
  // never land here in the first place (the RPC also refuses it server-side,
  // this is just so the UI doesn't invite an attempt that can't work).
  unlocked: boolean
  // Raw item_instances.sockets[index] value — null (unlocked but empty) or a
  // gemStorageKey string ("<gemId>_<tier>") if filled. A filled socket stays
  // a live drop target too — slots can be overwritten with a different gem,
  // just never emptied (see socket_gem's SQL, no "unsocket" path exists).
  filledKey: string | null
  // A gem dropped here but not yet confirmed (see ForgeSocketsTab's
  // pendingSocket) — rendered as a dimmed, dashed-ring "ghost" instead of a
  // committed fill, since socketing is irreversible and shouldn't happen on
  // drop alone.
  pendingGem?: { gemId: GemTypeId; tier: GemTier } | null
}

export default function ForgeSocketSlot({ index, unlocked, filledKey, pendingGem }: ForgeSocketSlotProps) {
  const isDropTarget = useIsDropTarget(`socket-${index}`)
  const parsed = filledKey ? parseGemStorageKey(filledKey) : null

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-300">Socket {index + 1}</p>
      </div>

      {unlocked ? (
        <div
          data-drop-zone={`socket-${index}`}
          className={`${SLOT_SIZE_CLASS} shrink-0 rounded-lg transition-shadow ${
            isDropTarget ? 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : pendingGem ? 'ring-2 ring-dashed ring-amber-400/70' : ''
          }`}
        >
          {pendingGem ? (
            <div className="opacity-50">
              <InventorySlot
                slotId={`forge-socket-${index}-pending`}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon="💎"
                iconSrc={getGemIconSrc(pendingGem.gemId, pendingGem.tier)}
                qualityColor={getGemTierColor(pendingGem.tier)}
                tooltip={buildGemTooltip(pendingGem.gemId, pendingGem.tier)}
              />
            </div>
          ) : parsed ? (
            <InventorySlot
              slotId={`forge-socket-${index}`}
              filled
              sizeClassName={SLOT_SIZE_CLASS}
              icon="💎"
              iconSrc={getGemIconSrc(parsed.gemId, parsed.tier)}
              qualityColor={getGemTierColor(parsed.tier)}
              tooltip={buildGemTooltip(parsed.gemId, parsed.tier)}
            />
          ) : (
            <InventorySlot slotId={`forge-socket-${index}-empty`} filled={false} sizeClassName={SLOT_SIZE_CLASS} emptyHint="Drop gem here" />
          )}
        </div>
      ) : (
        <div className={SLOT_SIZE_CLASS}>
          <InventorySlot slotId={`forge-socket-${index}-locked`} filled={false} sizeClassName={SLOT_SIZE_CLASS} emptyHint="Locked" />
        </div>
      )}
    </div>
  )
}
