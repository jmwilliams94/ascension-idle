export interface TileCoord {
  x: number
  y: number
}

export const GRID_SIZE = 100
export const TILE_WIDTH = 96
export const TILE_HEIGHT = 48
export const GRID_ORIGIN = { x: 320, y: 180 }

export function tileToWorld(
  tile: TileCoord,
  tileWidth = TILE_WIDTH,
  tileHeight = TILE_HEIGHT,
  originX = GRID_ORIGIN.x,
  originY = GRID_ORIGIN.y,
) {
  return {
    x: originX + (tile.x - tile.y) * (tileWidth / 2),
    y: originY + (tile.x + tile.y) * (tileHeight / 2),
  }
}

export function worldToTile(
  x: number,
  y: number,
  tileWidth = TILE_WIDTH,
  tileHeight = TILE_HEIGHT,
  originX = GRID_ORIGIN.x,
  originY = GRID_ORIGIN.y,
): TileCoord {
  const dx = x - originX
  const dy = y - originY

  return {
    x: Math.round((dx / (tileWidth / 2) + dy / (tileHeight / 2)) / 2),
    y: Math.round((dy / (tileHeight / 2) - dx / (tileWidth / 2)) / 2),
  }
}

export function isInBounds(tile: TileCoord) {
  return tile.x >= 0 && tile.x < GRID_SIZE && tile.y >= 0 && tile.y < GRID_SIZE
}
