// Reusable disposable icon-processing script (same convention as every other
// gear icon this project has added) — for the flat-white-background,
// no-glow source images now being supplied. Flood-fills the white
// background into real alpha transparency (BFS from the edges, only walking
// connected white-ish pixels, so nothing inside the art gets eaten), trims,
// pads to square, resizes to 320x320. Outputs lossless WebP (matching the
// whole public/item-icons/ set as of v1.125.23) when DEST ends in .webp,
// else PNG.
//
// Usage: node scripts/process-white-bg-icon.mjs <src-path> <dest-path> [size]
import sharp from 'sharp'

const [, , SRC, DEST, SIZE_ARG] = process.argv
if (!SRC || !DEST) {
  console.error('Usage: node scripts/process-white-bg-icon.mjs <src-path> <dest-path> [size]')
  process.exit(1)
}

const TARGET_SIZE = SIZE_ARG ? Number(SIZE_ARG) : 320
const WHITE_THRESHOLD = 245

async function main() {
  const image = sharp(SRC).ensureAlpha()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info

  const isBackgroundColor = (idx) => data[idx] >= WHITE_THRESHOLD && data[idx + 1] >= WHITE_THRESHOLD && data[idx + 2] >= WHITE_THRESHOLD

  const visited = new Uint8Array(width * height)
  const queue = []

  const pushIfBackground = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const pixelIndex = y * width + x
    if (visited[pixelIndex]) return
    const dataIdx = pixelIndex * channels
    if (!isBackgroundColor(dataIdx)) return
    visited[pixelIndex] = 1
    queue.push(pixelIndex)
  }

  for (let x = 0; x < width; x += 1) {
    pushIfBackground(x, 0)
    pushIfBackground(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    pushIfBackground(0, y)
    pushIfBackground(width - 1, y)
  }

  let head = 0
  while (head < queue.length) {
    const pixelIndex = queue[head]
    head += 1
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    pushIfBackground(x + 1, y)
    pushIfBackground(x - 1, y)
    pushIfBackground(x, y + 1)
    pushIfBackground(x, y - 1)
  }

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    if (visited[pixelIndex]) {
      data[pixelIndex * channels + 3] = 0
    }
  }

  const transparentBg = sharp(data, { raw: { width, height, channels } }).png()
  const trimmed = await transparentBg.trim({ threshold: 10 }).toBuffer()
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

  // Verify against real alpha data, not a visual guess — see the Lucky Bow
  // incident (a checkerboard-preview pattern baked into pixels looked fine
  // next to the editor's own checkerboard but had zero real transparency).
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
    srcSize: `${width}x${height}`,
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
