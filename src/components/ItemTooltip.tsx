import type { ItemTooltipData } from '../game/items/itemTooltip'

// Universal Diablo/PoE-style hover tooltip — dark card, quality-colored title,
// secondary info lines, then a visually distinct stats block. Used everywhere an
// item/weapon/stone/arrow tile is shown (see InventorySlot's `tooltip` prop and
// EquipmentSlot) so hovering any of them looks and reads the same way.
export default function ItemTooltip({ title, titleColor, lines, stats }: ItemTooltipData) {
  return (
    <div className="w-52 rounded-lg border border-slate-700 bg-slate-950/95 p-2.5 text-left shadow-xl shadow-black/50">
      <p className="text-sm font-semibold" style={{ color: titleColor ?? '#e2e8f0' }}>
        {title}
      </p>

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
