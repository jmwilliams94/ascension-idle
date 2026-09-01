import type { CSSProperties } from 'react'
import { DEFAULT_STAT_COLOR, type ItemTooltipData, type TooltipLine } from '../game/items/itemTooltip'
import { BLESS_COLOR, ENCHANT_HP_COLOR } from '../game/items/gemCatalog'
import { TierEmberEffect } from '../game/items/tierEffects'
import { emberCountForColor, seedFromId } from '../game/items/tierEffectsData'

// `lines`' own default (matches the old flat text-slate-400) — a plain
// string entry in either array falls back to its block's default; a
// { text, color } entry overrides just that one line (see TooltipLine).
// `stats`' own default lives in itemTooltip.ts (DEFAULT_STAT_COLOR), shared
// with buildGearTooltip so a stat line placed inside `lines` instead (see
// that function) can still be explicitly colored to match.
const DEFAULT_LINE_COLOR = '#94a3b8'

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
export default function ItemTooltip({
  title,
  titleColor,
  icon,
  iconSrc,
  iconColor,
  lines,
  stats,
  bonusStats,
  enchantLine,
  blessLine,
  progressionLine,
}: ItemTooltipData) {
  const hasIcon = Boolean(icon || iconSrc)
  // Gear tooltips (2026-08-13 reorder) no longer populate `stats` — their
  // base stats moved into `lines` — but bonusStats/enchantLine/blessLine
  // still need this bordered block to render, so the block's visibility
  // can't gate on `stats.length` alone anymore.
  const hasBonusBlock = (stats && stats.length > 0) || (bonusStats && bonusStats.length > 0) || Boolean(enchantLine) || Boolean(blessLine)
  // Same radiating-ember effect InventorySlot's tile already renders — was
  // missing here entirely, so hovering a rare item never showed it even
  // though the grid tile underneath it did. Seeded off `title` (no stable
  // per-instance id reaches this component) rather than InventorySlot's
  // slotId, so the exact ember layout won't match the tile 1:1, but stays
  // stable across re-renders of the same tooltip.
  const emberCount = emberCountForColor(iconColor)
  // Colors the outer chamfered chip frame to match the icon box's own
  // quality-tier color (2026-09-01, requested alongside the ember fix) —
  // see .ascension-chip-frame.is-item-tiered in index.css for why this is a
  // separate modifier from .is-tinted rather than reusing it.
  const chipFrameStyle: CSSProperties = iconColor ? ({ '--item-tier-color': iconColor } as CSSProperties) : {}

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

      {hasBonusBlock && (
        <div className="mt-1.5 space-y-0.5 border-t border-slate-800 pt-1.5">
          {stats?.map((stat, index) => (
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
          {blessLine && (
            <p className="text-[11px] font-medium" style={{ color: BLESS_COLOR }}>
              {blessLine}
            </p>
          )}
        </div>
      )}

      {progressionLine && (
        <p className="mt-1.5 border-t border-slate-800 pt-1.5 text-[11px] font-medium text-white">{progressionLine}</p>
      )}
    </>
  )

  return (
    <div
      className={`ascension-chip-frame w-64 shadow-xl shadow-black/50 ${iconColor ? 'is-item-tiered' : ''}`}
      style={chipFrameStyle}
    >
      <div className="ascension-chip-inner p-2.5 text-left">
        {hasIcon ? (
          <div className="flex items-start gap-2">
            <div
              className="item-quality-frame relative flex h-22 w-22 shrink-0 items-center justify-center text-lg"
              style={iconColor ? ({ '--item-tier-color': iconColor } as CSSProperties) : undefined}
            >
              <div className="item-quality-frame-inner relative flex h-full w-full items-center justify-center overflow-hidden">
                {emberCount > 0 && <TierEmberEffect color={iconColor as string} count={emberCount} seed={seedFromId(title)} />}
                {iconSrc ? (
                  <img src={iconSrc} alt="" className="relative z-10 h-4/5 w-4/5 object-contain" />
                ) : (
                  <span className="relative z-10">{icon}</span>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">{body}</div>
          </div>
        ) : (
          body
        )}
      </div>
    </div>
  )
}
