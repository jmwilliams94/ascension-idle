import Phaser from 'phaser'
import {
  GRID_SIZE,
  TILE_HEIGHT,
  TILE_WIDTH,
  type TileCoord,
  isInBounds,
  tileToWorld,
  worldToTile,
} from '../utils/grid'

type TileMarker = {
  graphic: Phaser.GameObjects.Graphics
  coord: TileCoord
}

export default class IsometricScene extends Phaser.Scene {
  private tileMarkers: TileMarker[] = []
  private hero?: Phaser.GameObjects.Arc

  constructor() {
    super('IsometricScene')
  }

  create() {
    const origin = { x: this.scale.width / 2, y: this.scale.height / 2 - 80 }

    this.cameras.main.setBackgroundColor('#020617')
    this.cameras.main.setZoom(1)
    this.cameras.main.centerOn(origin.x, origin.y)

    this.tileMarkers = []

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const world = tileToWorld({ x, y }, TILE_WIDTH, TILE_HEIGHT, origin.x, origin.y)
        const graphic = this.add.graphics({ x: 0, y: 0 })
        graphic.fillStyle(this.getTileColor(x, y), 0.95)
        graphic.lineStyle(2, 0x334155, 0.85)
        graphic.beginPath()
        graphic.moveTo(world.x, world.y - TILE_HEIGHT / 2)
        graphic.lineTo(world.x + TILE_WIDTH / 2, world.y)
        graphic.lineTo(world.x, world.y + TILE_HEIGHT / 2)
        graphic.lineTo(world.x - TILE_WIDTH / 2, world.y)
        graphic.closePath()
        graphic.fillPath()
        graphic.strokePath()

        this.tileMarkers.push({ graphic, coord: { x, y } })
      }
    }

    this.placeHero({ x: 3, y: 3 }, origin)
    this.sortDepths(origin)

    this.input.keyboard?.on('keydown-LEFT', () => this.handleMove(-1, 0, origin))
    this.input.keyboard?.on('keydown-RIGHT', () => this.handleMove(1, 0, origin))
    this.input.keyboard?.on('keydown-UP', () => this.handleMove(0, -1, origin))
    this.input.keyboard?.on('keydown-DOWN', () => this.handleMove(0, 1, origin))

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) {
        return
      }

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const targetTile = worldToTile(world.x, world.y, TILE_WIDTH, TILE_HEIGHT, origin.x, origin.y)

      if (isInBounds(targetTile)) {
        this.moveHeroToTile(targetTile, origin)
      }
    })
  }

  private placeHero(tile: TileCoord, origin: { x: number; y: number }) {
    const world = tileToWorld(tile, TILE_WIDTH, TILE_HEIGHT, origin.x, origin.y)
    const hero = this.add.circle(world.x, world.y, 16, 0xffb347)
    hero.setStrokeStyle(3, 0xffffff)
    hero.setData('tile', tile)
    this.hero = hero
    this.sortDepths(origin)
  }

  private handleMove(deltaX: number, deltaY: number, origin: { x: number; y: number }) {
    const currentTile = this.hero?.getData('tile') as TileCoord | undefined

    if (!currentTile) {
      return
    }

    const nextTile = { x: currentTile.x + deltaX, y: currentTile.y + deltaY }

    if (isInBounds(nextTile)) {
      this.moveHeroToTile(nextTile, origin)
    }
  }

  private moveHeroToTile(nextTile: TileCoord, origin: { x: number; y: number }) {
    if (!this.hero) {
      return
    }

    const currentTile = this.hero.getData('tile') as TileCoord | undefined

    if (!currentTile || (currentTile.x === nextTile.x && currentTile.y === nextTile.y)) {
      return
    }

    const world = tileToWorld(nextTile, TILE_WIDTH, TILE_HEIGHT, origin.x, origin.y)

    this.tweens.add({
      targets: this.hero,
      x: world.x,
      y: world.y,
      duration: 220,
      ease: 'Cubic.Out',
    })

    this.hero.setData('tile', nextTile)
    this.sortDepths(origin)
  }

  private sortDepths(origin: { x: number; y: number }) {
    this.tileMarkers.forEach((tile) => {
      const world = tileToWorld(tile.coord, TILE_WIDTH, TILE_HEIGHT, origin.x, origin.y)
      tile.graphic.setDepth(world.y)
    })

    if (this.hero) {
      const tile = this.hero.getData('tile') as TileCoord | undefined

      if (tile) {
        const world = tileToWorld(tile, TILE_WIDTH, TILE_HEIGHT, origin.x, origin.y)
        this.hero.setDepth(world.y + 1)
      }
    }
  }

  private getTileColor(x: number, y: number) {
    const palette = [0x1e293b, 0x334155, 0x475569, 0x64748b]
    const index = (x + y) % palette.length
    return palette[index]
  }
}
