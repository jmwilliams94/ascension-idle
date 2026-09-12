// Loader for Aseprite's own `export_spritesheet` JSON format (frames keyed by
// per-frame filename + a `meta.frameTags` array) -- greybox character art is
// authored directly in Aseprite (see the pixel-plugin MCP tools) and exported
// as-is, so this reads that format natively rather than inventing a bespoke
// one. No sprite-sheet loading of any kind existed anywhere in this codebase
// before this (checked before writing it).

export interface SpriteFrameRect {
  x: number
  y: number
  w: number
  h: number
  durationMs: number
}

export type SpriteTagDirection = 'forward' | 'reverse' | 'pingpong'

export interface SpriteTag {
  from: number
  to: number
  direction: SpriteTagDirection
}

export interface SpriteSheet {
  image: HTMLImageElement
  frames: SpriteFrameRect[]
  tags: Record<string, SpriteTag>
}

interface AsepriteExportJson {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; duration: number }>
  meta: {
    image: string
    frameTags: { name: string; from: number; to: number; direction: string }[]
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load sprite image: ${src}`))
    image.src = src
  })
}

export async function loadSpriteSheet(jsonUrl: string): Promise<SpriteSheet> {
  const response = await fetch(jsonUrl)
  const data: AsepriteExportJson = await response.json()

  const frames = Object.values(data.frames).map((entry) => ({
    x: entry.frame.x,
    y: entry.frame.y,
    w: entry.frame.w,
    h: entry.frame.h,
    durationMs: entry.duration,
  }))

  const tags: Record<string, SpriteTag> = {}
  for (const tag of data.meta.frameTags) {
    tags[tag.name] = { from: tag.from, to: tag.to, direction: tag.direction as SpriteTagDirection }
  }

  const imageUrl = new URL(data.meta.image, jsonUrl).toString()
  const image = await loadImage(imageUrl)

  return { image, frames, tags }
}
