import type { ItemTooltipData } from '../game/items/itemTooltip'

// Universal Diablo/PoE-style hover tooltip — dark card, quality-colored title,
// secondary info lines, then a visually distinct stats block. Used everywhere an
// item/weapon/stone/arrow tile is shown (see InventorySlot's `tooltip` prop and
// EquipmentSlot) so hovering any of them looks and reads the same way.
export default function ItemTooltip({ title, titleColor, icon, iconSrc, iconColor, lines, stats }: ItemTooltipData) {
  const hasIcon = Boolean(icon || iconSrc)

  return (
    <div className="w-52 rounded-lg border border-slate-700 bg-slate-950/95 p-2.5 text-left shadow-xl shadow-black/50">
      <div className={hasIcon ? 'flex items-center gap-2' : ''}>
        {hasIcon && (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-base"
            style={{ borderColor: iconColor ?? '#475569', backgroundColor: iconColor ? `${iconColor}22` : undefined }}
          >
            {iconSrc ? <img src={iconSrc} alt="" className="h-3/5 w-3/5 object-contain" /> : <span>{icon}</span>}
          </div>
        )}
        <p className="text-sm font-semibold leading-tight" style={{ color: titleColor ?? '#e2e8f0' }}>
          {title}
        </p>
      </div>

      {lines && lines.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {lines.map((line, index) => (
            <p key={index} className="text-[11px] text-slate-400">
              {line}
            </p>
          ))}
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t border-slate-800 pt-1.5">
          {stats.map((stat, index) => (
            <p key={index} className="text-[11px] text-sky-300">
              {stat}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
