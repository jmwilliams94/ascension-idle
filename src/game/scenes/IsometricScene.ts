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

const VISIBLE_SIZE = 16
// VISIBLE_SIZE is even, so there's no single center tile: the hero's tile gets one
// extra neighbor before it than after (still rendered dead-center on screen either way).
const VISIBLE_RADIUS_BEFORE = Math.floor((VISIBLE_SIZE - 1) / 2)
const VISIBLE_RADIUS_AFTER = Math.ceil((VISIBLE_SIZE - 1) / 2)

const HERO_FOOTPRINT_SCALE = 0.4
const HERO_HALF_WIDTH = (TILE_WIDTH / 2) * HERO_FOOTPRINT_SCALE
const HERO_HALF_DEPTH = (TILE_HEIGHT / 2) * HERO_FOOTPRINT_SCALE
const HERO_BOX_HEIGHT = 32

export default class IsometricScene extends Phaser.Scene {
  private tileMarkers: TileMarker[] = []
  private tileContainer?: Phaser.GameObjects.Container
  private heroContainer?: Phaser.GameObjects.Container
  private heroTile: TileCoord = { x: 50, y: 50 }
  private origin = { x: 0, y: 0 }
  private isMoving = false
  private previousVisible = new Set<string>()

  constructor() {
    super('IsometricScene')
  }

  create() {
    this.origin = { x: this.scale.width / 2, y: this.scale.height / 2 - 80 }

    this.cameras.main.setBackgroundColor('#020617')
    this.cameras.main.setZoom(1)
    this.cameras.main.centerOn(this.origin.x, this.origin.y)

    this.tileContainer = this.add.container(this.origin.x, this.origin.y)
    this.tileMarkers = []

    this.buildVisibleTiles()
    this.placeHero()

    this.input.keyboard?.on('keydown-LEFT', () => this.moveToTile({ x: this.heroTile.x - 1, y: this.heroTile.y }))
    this.input.keyboard?.on('keydown-RIGHT', () => this.moveToTile({ x: this.heroTile.x + 1, y: this.heroTile.y }))
    this.input.keyboard?.on('keydown-UP', () => this.moveToTile({ x: this.heroTile.x, y: this.heroTile.y - 1 }))
    this.input.keyboard?.on('keydown-DOWN', () => this.moveToTile({ x: this.heroTile.x, y: this.heroTile.y + 1 }))

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown() || this.isMoving) {
        return
      }

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const relativeTile = worldToTile(world.x, world.y, TILE_WIDTH, TILE_HEIGHT, this.origin.x, this.origin.y)
      const targetTile = {
        x: this.heroTile.x + relativeTile.x,
        y: this.heroTile.y + relativeTile.y,
      }

      this.moveToTile(targetTile)
    })
  }

  private buildVisibleTiles(centerTile: TileCoord = this.heroTile, initialOffset?: { x: number; y: number }) {
    if (!this.tileContainer) {
      return
    }

    const visibleTiles: TileCoord[] = []
    const startX = Math.max(0, centerTile.x - VISIBLE_RADIUS_BEFORE)
    const startY = Math.max(0, centerTile.y - VISIBLE_RADIUS_BEFORE)
    const endX = Math.min(GRID_SIZE - 1, centerTile.x + VISIBLE_RADIUS_AFTER)
    const endY = Math.min(GRID_SIZE - 1, centerTile.y + VISIBLE_RADIUS_AFTER)

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        visibleTiles.push({ x, y })
      }
    }

    const visibleKeys = new Set(visibleTiles.map((tile) => `${tile.x},${tile.y}`))
    const newTiles = visibleTiles.filter((tile) => !this.previousVisible.has(`${tile.x},${tile.y}`))
    const sortedNewTiles = [...newTiles].sort((a, b) => {
      const aDist = Math.abs(a.x - centerTile.x) + Math.abs(a.y - centerTile.y)
      const bDist = Math.abs(b.x - centerTile.x) + Math.abs(b.y - centerTile.y)
      return aDist - bDist
    })

    this.tileContainer.removeAll(true)
    this.tileMarkers = []
    this.tileContainer.setPosition(
      this.origin.x + (initialOffset?.x ?? 0),
      this.origin.y + (initialOffset?.y ?? 0),
    )

    visibleTiles.forEach((tile) => {
      const relative = { x: tile.x - centerTile.x, y: tile.y - centerTile.y }
      const world = tileToWorld(relative, TILE_WIDTH, TILE_HEIGHT, this.origin.x, this.origin.y)
      const graphic = this.add.graphics({ x: world.x - this.origin.x, y: world.y - this.origin.y })
      graphic.fillStyle(this.getTileColor(tile.x, tile.y), 0.95)
      graphic.lineStyle(2, 0x334155, 0.85)
      graphic.beginPath()
      graphic.moveTo(0, -TILE_HEIGHT / 2)
      graphic.lineTo(TILE_WIDTH / 2, 0)
      graphic.lineTo(0, TILE_HEIGHT / 2)
      graphic.lineTo(-TILE_WIDTH / 2, 0)
      graphic.closePath()
      graphic.fillPath()
      graphic.strokePath()

      const isNew = newTiles.some((entry) => entry.x === tile.x && entry.y === tile.y)
      graphic.alpha = isNew ? 0 : 1
      graphic.setScale(isNew ? 0.75 : 1)

      this.tileContainer!.add(graphic)
      this.tileMarkers.push({ graphic, coord: tile })
    })

    sortedNewTiles.forEach((tile) => {
      const marker = this.tileMarkers.find((entry) => entry.coord.x === tile.x && entry.coord.y === tile.y)
      if (!marker) {
        return
      }

      const distance = Math.abs(tile.x - centerTile.x) + Math.abs(tile.y - centerTile.y)
      this.tweens.add({
        targets: marker.graphic,
        alpha: 1,
        scale: 1,
        duration: 260,
        delay: distance * 25,
        ease: 'Cubic.Out',
      })
    })

    this.previousVisible = visibleKeys
    this.sortDepths()
  }

  private buildPath(from: TileCoord, to: TileCoord) {
    const path: TileCoord[] = []
    let current = { ...from }

    while (current.x !== to.x || current.y !== to.y) {
      const stepX = current.x < to.x ? 1 : current.x > to.x ? -1 : 0
      const stepY = current.y < to.y ? 1 : current.y > to.y ? -1 : 0
      current = { x: current.x + stepX, y: current.y + stepY }

      if (!isInBounds(current)) {
        break
      }

      path.push({ ...current })
    }

    return path
  }

  private placeHero() {
    if (this.heroContainer) {
      this.heroContainer.destroy(true)
    }

    // The container's local (0, 0) is the hero's footprint center, so it must sit
    // exactly on the tile's world center (this.origin for the tile the hero occupies)
    // with no extra offset, or the box will drift off-center.
    this.heroContainer = this.add.container(this.origin.x, this.origin.y).setDepth(999)
    this.heroContainer.add(this.buildHeroBox())
  }

  private buildHeroBox() {
    const hw = HERO_HALF_WIDTH
    const hd = HERO_HALF_DEPTH
    const height = HERO_BOX_HEIGHT

    // A rectangular prism drawn as three shaded faces (top, right, left) so it reads
    // as a 2.5D box: top lightest (as if lit from above), left darkest (in shadow).
    const topFace = this.add.graphics()
    topFace.fillStyle(0xe2e8f0, 1)
    topFace.beginPath()
    topFace.moveTo(0, -hd - height)
    topFace.lineTo(hw, -height)
    topFace.lineTo(0, hd - height)
    topFace.lineTo(-hw, -height)
    topFace.closePath()
    topFace.fillPath()

    const rightFace = this.add.graphics()
    rightFace.fillStyle(0x94a3b8, 1)
    rightFace.beginPath()
    rightFace.moveTo(0, hd)
    rightFace.lineTo(hw, 0)
    rightFace.lineTo(hw, -height)
    rightFace.lineTo(0, hd - height)
    rightFace.closePath()
    rightFace.fillPath()

    const leftFace = this.add.graphics()
    leftFace.fillStyle(0x64748b, 1)
    leftFace.beginPath()
    leftFace.moveTo(0, hd)
    leftFace.lineTo(-hw, 0)
    leftFace.lineTo(-hw, -height)
    leftFace.lineTo(0, hd - height)
    leftFace.closePath()
    leftFace.fillPath()

    return [topFace, rightFace, leftFace]
  }

  private moveToTile(targetTile: TileCoord) {
    if (this.isMoving || !isInBounds(targetTile) || (this.heroTile.x === targetTile.x && this.heroTile.y === targetTile.y)) {
      return
    }

    const path = this.buildPath(this.heroTile, targetTile)

    if (path.length === 0) {
      return
    }

    this.isMoving = true

    if (path.length > 1) {
      this.jumpToTile(targetTile)
    } else {
      this.walkPath(path)
    }
  }

  private walkPath(path: TileCoord[]) {
    if (path.length === 0) {
      this.isMoving = false
      return
    }

    const nextTile = path.shift()!
    const delta = {
      x: nextTile.x - this.heroTile.x,
      y: nextTile.y - this.heroTile.y,
    }

    const moveOffset = tileToWorld(delta, TILE_WIDTH, TILE_HEIGHT, 0, 0)
    const startOffset = { x: moveOffset.x, y: moveOffset.y }

    if (!this.tileContainer) {
      return
    }

    this.buildVisibleTiles(nextTile, startOffset)

    this.tweens.add({
      targets: this.tileContainer,
      x: this.origin.x,
      y: this.origin.y,
      duration: 220,
      ease: 'Cubic.Out',
      onComplete: () => {
        this.heroTile = nextTile
        this.walkPath(path)
      },
    })
  }

  private jumpToTile(targetTile: TileCoord) {
    if (!this.tileContainer || !this.heroContainer) {
      return
    }

    const delta = {
      x: targetTile.x - this.heroTile.x,
      y: targetTile.y - this.heroTile.y,
    }

    const moveOffset = tileToWorld(delta, TILE_WIDTH, TILE_HEIGHT, 0, 0)
    const startOffset = { x: moveOffset.x, y: moveOffset.y }
    const heroBaseY = this.origin.y

    this.buildVisibleTiles(targetTile, startOffset)
    this.heroContainer.setY(heroBaseY)

    const jumpState = { progress: 0 }
    this.tweens.add({
      targets: jumpState,
      progress: 1,
      duration: 600,
      ease: 'Sine.InOut',
      onUpdate: () => {
        const t = jumpState.progress
        const arc = Math.sin(Math.PI * t) * 44
        this.heroContainer!.setY(heroBaseY - arc)
      },
      onComplete: () => {
        this.heroTile = targetTile
        this.isMoving = false
      },
    })

    this.tweens.add({
      targets: this.tileContainer,
      x: this.origin.x,
      y: this.origin.y,
      duration: 600,
      ease: 'Cubic.InOut',
    })
  }

  private sortDepths() {
    this.tileMarkers.forEach((tile) => {
      const relative = { x: tile.coord.x - this.heroTile.x, y: tile.coord.y - this.heroTile.y }
      const world = tileToWorld(relative, TILE_WIDTH, TILE_HEIGHT, this.origin.x, this.origin.y)
      tile.graphic.setDepth(world.y)
    })
  }

  private getTileColor(x: number, y: number) {
    const palette = [0x1e293b, 0x334155, 0x475569, 0x64748b]
    const index = (x + y) % palette.length
    return palette[index]
  }
}
