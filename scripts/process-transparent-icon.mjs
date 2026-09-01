// Reusable disposable icon-processing script for sources that ALREADY have
// genuine alpha transparency (e.g. an iPhone subject-lift selection) —
// no background-removal step needed, just trim the transparent margin, pad
// to square, resize to 320x320. Same verification convention as
// process-white-bg-icon.mjs. Outputs lossless WebP (matching the whole
// public/item-icons/ set as of v1.125.23) when DEST ends in .webp, else PNG.
//
// Usage: node scripts/process-transparent-icon.mjs <src-path> <dest-path> [size]
import sharp from 'sharp'

const [, , SRC, DEST, SIZE_ARG] = process.argv
if (!SRC || !DEST) {
  console.error('Usage: node scripts/process-transparent-icon.mjs <src-path> <dest-path> [size]')
  process.exit(1)
}

const TARGET_SIZE = SIZE_ARG ? Number(SIZE_ARG) : 320

async function main() {
  const trimmed = await sharp(SRC).ensureAlpha().trim({ threshold: 10 }).toBuffer()
  const trimmedMeta = await sharp(trimmed).metadata()
  const side = Math.max(trimmedMeta.width, trimmedMeta.height)

  const resized = sharp(trimmed)
    .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })

  if (DEST.endsWith('.webp')) {
    await resized.webp({ lossless: true }).toFile(DEST)
  } else {
    await resized.png().toFile(DEST)
  }

  const { data: finalData, info: finalInfo } = await sharp(DEST).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
  const totalPixels = finalInfo.width * finalInfo.height
  let opaque = 0
  let transparent = 0
  let partial = 0
  for (let i = 0; i < totalPixels; i += 1) {
    const a = finalData[i * finalInfo.channels + 3]
    if (a === 0) transparent += 1
    else if (a === 255) opaque += 1
    else partial += 1
  }

  console.log('done', {
    finalSize: `${finalInfo.width}x${finalInfo.height}`,
    transparentPct: ((transparent / totalPixels) * 100).toFixed(1) + '%',
    opaquePct: ((opaque / totalPixels) * 100).toFixed(1) + '%',
    partialPct: ((partial / totalPixels) * 100).toFixed(1) + '%',
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
