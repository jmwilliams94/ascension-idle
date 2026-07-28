import { getSlotVisual } from '../game/items/equipmentBonus'

interface PaperDollBodyProps {
  headQualityTier?: string | null
  bodyQualityTier?: string | null
  bootsQualityTier?: string | null
  weaponQualityTier?: string | null
}

// Abstract/geometric stand-in for character art, matching the game's "greybox"
// visual identity — no silhouette, no sprite. Three stacked horizontal bands
// (Headgear / Body-Armor / Boots), each tinted by whatever's equipped in that slot
// (see getSlotVisual), plus a thin accent along the left edge for Weapon — not a
// body-worn slot, so it doesn't get its own band. Pass undefined/null for any slot
// without an item system yet (Headgear/Body/Boots today) and it renders neutral;
// once that slot becomes functional, passing its real quality_tier lights it up
// automatically — no rebuild needed.
export default function PaperDollBody({
  headQualityTier,
  bodyQualityTier,
  bootsQualityTier,
  weaponQualityTier,
}: PaperDollBodyProps) {
  const head = getSlotVisual(headQualityTier)
  const body = getSlotVisual(bodyQualityTier)
  const boots = getSlotVisual(bootsQualityTier)
  const weapon = getSlotVisual(weaponQualityTier)

  return (
    <div className="relative h-36 w-20">
      <div
        title="Weapon accent"
        className={`absolute -left-2 top-1 h-[calc(100%-0.5rem)] w-1.5 rounded-full ${weapon.glow ? 'super-quality-glow' : ''}`}
        style={{ background: weapon.background }}
      />

      <div className="flex h-full w-full flex-col gap-0.5 rounded-2xl border-2 border-slate-700 p-0.5">
        <div
          title="Headgear slot"
          className={`flex-1 rounded-t-xl ${head.glow ? 'super-quality-glow' : ''}`}
          style={{ background: head.background }}
        />
        <div
          title="Body/Armor slot"
          className={`flex-1 ${body.glow ? 'super-quality-glow' : ''}`}
          style={{ background: body.background }}
        />
        <div
          title="Boots slot"
          className={`flex-1 rounded-b-xl ${boots.glow ? 'super-quality-glow' : ''}`}
          style={{ background: boots.background }}
        />
      </div>
    </div>
  )
}
