import type { ItemTooltipData, TooltipLine } from '../game/items/itemTooltip'
import { ENCHANT_HP_COLOR } from '../game/items/gemCatalog'

// `lines`' own default (matches the old flat text-slate-400) and `stats`' own
// default (matches the old flat text-sky-300) — a plain string entry in
// either array falls back to its block's default; a { text, color } entry
// overrides just that one line (see TooltipLine).
const DEFAULT_LINE_COLOR = '#94a3b8'
const DEFAULT_STAT_COLOR = '#7dd3fc'

function lineText(line: TooltipLine): string {
  return typeof line === 'string' ? line : line.text
}

function lineColor(line: TooltipLine, fallback: string): string {
  return typeof line === 'string' ? fallback : line.color
}

// Universal Diablo/PoE-style hover tooltip — dark card, quality-colored title,
// secondary info lines, then a visually distinct stats block. Used everywhere an
// item/weapon/stone/arrow tile is shown (see InventorySlot's `tooltip` prop and
// EquipmentSlot) so hovering any of them looks and reads the same way.
export default function ItemTooltip({ title, titleColor, icon, iconSrc, iconColor, lines, stats, bonusStats, enchantLine }: ItemTooltipData) {
  const hasIcon = Boolean(icon || iconSrc)

  const body = (
    <>
      <p className="text-sm font-semibold leading-tight" style={{ color: titleColor ?? '#e2e8f0' }}>
        {title}
      </p>

      {lines && lines.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {lines.map((line, index) => (
            <p key={index} className="text-[11px]" style={{ color: lineColor(line, DEFAULT_LINE_COLOR) }}>
              {lineText(line)}
            </p>
          ))}
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t border-slate-800 pt-1.5">
          {stats.map((stat, index) => (
            <p key={index} className="text-[11px]" style={{ color: lineColor(stat, DEFAULT_STAT_COLOR) }}>
              {lineText(stat)}
            </p>
          ))}
          {bonusStats?.map((stat, index) => (
            <p key={`bonus-${index}`} className="text-[11px] text-purple-400">
              {stat}
            </p>
          ))}
          {enchantLine && (
            <p className="text-[11px] font-medium" style={{ color: ENCHANT_HP_COLOR }}>
              {enchantLine}
            </p>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className="w-64 rounded-lg border border-slate-700 bg-slate-950/95 p-2.5 text-left shadow-xl shadow-black/50">
      {hasIcon ? (
        <div className="flex items-start gap-2">
          <div
            className="flex h-22 w-22 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
            style={{ borderColor: iconColor ?? '#475569', backgroundColor: iconColor ? `${iconColor}22` : undefined }}
          >
            {iconSrc ? <img src={iconSrc} alt="" className="h-4/5 w-4/5 object-contain" /> : <span>{icon}</span>}
          </div>
          <div className="min-w-0 flex-1">{body}</div>
        </div>
      ) : (
        body
      )}
    </div>
  )
}
