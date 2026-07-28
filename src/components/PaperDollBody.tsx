import { getSlotVisual } from '../game/items/equipmentBonus'

interface PaperDollBodyProps {
  headQualityTier?: string | null
  bodyQualityTier?: string | null
  bootsQualityTier?: string | null
  weaponQualityTier?: string | null
}

// Mirrors the exact isometric box geometry and shading the real hero sprite uses
// (IsometricScene.buildHeroBox: top #e2e8f0, right #94a3b8, left #64748b), scaled
// up for legibility, so the Equipment panel's central placeholder is a literal
// small twin of the in-game character rather than an unrelated shape. The box's
// half-width/half-depth ratio (2:1) matches the game's isometric tile ratio.
const HALF_WIDTH = 48
const HALF_DEPTH = 24
const HEIGHT = 80

// Where the body/boots cut falls, as a fraction down each side face from its top
// edge (0) to its bottom edge (1) — boots get the bottom 30%.
const BOOTS_SPLIT = 0.7

const BASE_TOP = '#e2e8f0'
const BASE_RIGHT = '#94a3b8'
const BASE_LEFT = '#64748b'
const EDGE_NEUTRAL = '#475569' // front seam color when no weapon is equipped

function toPointsAttr(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
}

// Nothing equipped -> the face keeps the real hero box's own color (so the
// placeholder matches the sprite exactly by default). Something equipped -> tint
// with its quality color instead. Super quality also gets a pulsing glow.
function faceStyle(baseColor: string, qualityTier: string | null | undefined) {
  const visual = getSlotVisual(qualityTier)
  return {
    fill: visual.color ? `${visual.color}cc` : baseColor,
    glow: visual.glow,
  }
}

export default function PaperDollBody({
  headQualityTier,
  bodyQualityTier,
  bootsQualityTier,
  weaponQualityTier,
}: PaperDollBodyProps) {
  const hw = HALF_WIDTH
  const hd = HALF_DEPTH
  const h = HEIGHT

  // y-coordinates where the body/boots cut crosses the front seam (x=0) and each
  // side face's outer vertical edge (x=±hw).
  const cutFrontY = hd - h + BOOTS_SPLIT * h
  const cutSideY = -h + BOOTS_SPLIT * h

  const head = faceStyle(BASE_TOP, headQualityTier)
  const rightBody = faceStyle(BASE_RIGHT, bodyQualityTier)
  const rightBoots = faceStyle(BASE_RIGHT, bootsQualityTier)
  const leftBody = faceStyle(BASE_LEFT, bodyQualityTier)
  const leftBoots = faceStyle(BASE_LEFT, bootsQualityTier)

  const weaponVisual = getSlotVisual(weaponQualityTier)
  const edgeColor = weaponVisual.color ?? EDGE_NEUTRAL

  return (
    <svg viewBox="-54 -110 108 140" className="h-36 w-28" role="img" aria-label="Character equipment preview">
      <polygon
        points={toPointsAttr([
          [0, hd - h],
          [-hw, -h],
          [-hw, cutSideY],
          [0, cutFrontY],
        ])}
        fill={leftBody.fill}
        stroke={leftBody.fill}
        strokeWidth={0.75}
        className={leftBody.glow ? 'super-quality-glow' : undefined}
      />
      <polygon
        points={toPointsAttr([
          [0, cutFrontY],
          [-hw, cutSideY],
          [-hw, 0],
          [0, hd],
        ])}
        fill={leftBoots.fill}
        stroke={leftBoots.fill}
        strokeWidth={0.75}
        className={leftBoots.glow ? 'super-quality-glow' : undefined}
      />

      <polygon
        points={toPointsAttr([
          [0, hd - h],
          [hw, -h],
          [hw, cutSideY],
          [0, cutFrontY],
        ])}
        fill={rightBody.fill}
        stroke={rightBody.fill}
        strokeWidth={0.75}
        className={rightBody.glow ? 'super-quality-glow' : undefined}
      />
      <polygon
        points={toPointsAttr([
          [0, cutFrontY],
          [hw, cutSideY],
          [hw, 0],
          [0, hd],
        ])}
        fill={rightBoots.fill}
        stroke={rightBoots.fill}
        strokeWidth={0.75}
        className={rightBoots.glow ? 'super-quality-glow' : undefined}
      />

      <polygon
        points={toPointsAttr([
          [0, -hd - h],
          [hw, -h],
          [0, hd - h],
          [-hw, -h],
        ])}
        fill={head.fill}
        stroke={head.fill}
        strokeWidth={0.75}
        className={head.glow ? 'super-quality-glow' : undefined}
      />

      {/* Weapon isn't body-worn, so it's a thin accent along the box's front seam
          instead of its own face. */}
      <line
        x1={0}
        y1={hd - h}
        x2={0}
        y2={hd}
        stroke={edgeColor}
        strokeWidth={4}
        strokeLinecap="round"
        className={weaponVisual.glow ? 'super-quality-glow' : undefined}
      />
    </svg>
  )
}
