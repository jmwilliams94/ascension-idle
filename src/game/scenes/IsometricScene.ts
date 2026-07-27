import Phaser from 'phaser'
import {
  GRID_SIZE,
  TILE_HEIGHT,
  TILE_WIDTH,
  type TileCoord,
  chebyshevDistance,
  isInBounds,
  tileToWorld,
  worldToTile,
} from '../utils/grid'
import { CLASS_DEFINITIONS } from '../stats/classes'
import { computeDerivedStats } from '../stats/derivedStats'
import { useCharacterStore } from '../stats/useCharacterStore'

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

const ENEMY_FOOTPRINT_SCALE = 0.4
const ENEMY_HALF_WIDTH = (TILE_WIDTH / 2) * ENEMY_FOOTPRINT_SCALE
const ENEMY_HALF_DEPTH = (TILE_HEIGHT / 2) * ENEMY_FOOTPRINT_SCALE
const ENEMY_BOX_HEIGHT = 28

// Small enough to die in a few hits for easy testing — not a real balance value.
const ENEMY_MAX_HP = 50
// Testing convenience only, not real zone/spawn design (see spawnEnemy/killEnemy).
const ENEMY_RESPAWN_DELAY_MS = 3000
const FLOATING_TEXT_RISE_PX = 36
const FLOATING_TEXT_DURATION_MS = 1800

export default class IsometricScene extends Phaser.Scene {
  private tileMarkers: TileMarker[] = []
  private tileContainer?: Phaser.GameObjects.Container
  private heroContainer?: Phaser.GameObjects.Container
  private heroTile: TileCoord = { x: 50, y: 50 }
  private origin = { x: 0, y: 0 }
  private isMoving = false
  private previousVisible = new Set<string>()

  private enemyTile: TileCoord = { x: 53, y: 50 }
  private enemyContainer?: Phaser.GameObjects.Container
  private enemyHpText?: Phaser.GameObjects.Text
  private enemyHp = ENEMY_MAX_HP
  private enemyAlive = false
  private lastAttackAt = -Infinity

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
    this.spawnEnemy()

    this.input.keyboard?.on('keydown-LEFT', () => this.moveToTile({ x: this.heroTile.x - 1, y: this.heroTile.y }))
    this.input.keyboard?.on('keydown-RIGHT', () => this.moveToTile({ x: this.heroTile.x + 1, y: this.heroTile.y }))
    this.input.keyboard?.on('keydown-UP', () => this.moveToTile({ x: this.heroTile.x, y: this.heroTile.y - 1 }))
    this.input.keyboard?.on('keydown-DOWN', () => this.moveToTile({ x: this.heroTile.x, y: this.heroTile.y + 1 }))
    this.input.keyboard?.on('keydown-SPACE', () => this.attemptAttack())

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

      if (this.enemyAlive && targetTile.x === this.enemyTile.x && targetTile.y === this.enemyTile.y) {
        this.attemptAttack()
        return
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

    // Detach (don't destroy) the enemy before wiping the container's children below —
    // it's re-added and repositioned relative to the new center tile further down.
    if (this.enemyContainer) {
      this.tileContainer.remove(this.enemyContainer)
    }

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

    if (this.enemyContainer && this.enemyAlive) {
      this.positionEnemy(centerTile)
      this.tileContainer.add(this.enemyContainer)
    }

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

  // Placeholder stationary target for testing the combat loop. Not real zone/spawn
  // design — a single fixed enemy at a fixed tile, no movement, no aggro, no attacking back.
  private spawnEnemy() {
    this.enemyHp = ENEMY_MAX_HP
    this.enemyAlive = true
    this.enemyContainer = this.add.container(0, 0, this.buildEnemyBox())
    this.enemyHpText = this.add.text(0, -ENEMY_BOX_HEIGHT - ENEMY_HALF_DEPTH - 16, '', {
      fontSize: '13px',
      color: '#fca5a5',
      fontStyle: 'bold',
    }).setOrigin(0.5, 1)
    this.enemyContainer.add(this.enemyHpText)
    this.updateEnemyHpDisplay()

    this.positionEnemy(this.heroTile)
    this.tileContainer?.add(this.enemyContainer)
  }

  private buildEnemyBox() {
    const hw = ENEMY_HALF_WIDTH
    const hd = ENEMY_HALF_DEPTH
    const height = ENEMY_BOX_HEIGHT

    // Same shaded-box construction as the hero, but red-toned and slightly smaller
    // so it reads as a distinct, stationary target rather than another hero.
    const topFace = this.add.graphics()
    topFace.fillStyle(0xfca5a5, 1)
    topFace.beginPath()
    topFace.moveTo(0, -hd - height)
    topFace.lineTo(hw, -height)
    topFace.lineTo(0, hd - height)
    topFace.lineTo(-hw, -height)
    topFace.closePath()
    topFace.fillPath()

    const rightFace = this.add.graphics()
    rightFace.fillStyle(0xef4444, 1)
    rightFace.beginPath()
    rightFace.moveTo(0, hd)
    rightFace.lineTo(hw, 0)
    rightFace.lineTo(hw, -height)
    rightFace.lineTo(0, hd - height)
    rightFace.closePath()
    rightFace.fillPath()

    const leftFace = this.add.graphics()
    leftFace.fillStyle(0xb91c1c, 1)
    leftFace.beginPath()
    leftFace.moveTo(0, hd)
    leftFace.lineTo(-hw, 0)
    leftFace.lineTo(-hw, -height)
    leftFace.lineTo(0, hd - height)
    leftFace.closePath()
    leftFace.fillPath()

    return [topFace, rightFace, leftFace]
  }

  private positionEnemy(centerTile: TileCoord) {
    if (!this.enemyContainer) {
      return
    }

    const relative = { x: this.enemyTile.x - centerTile.x, y: this.enemyTile.y - centerTile.y }
    const local = tileToWorld(relative, TILE_WIDTH, TILE_HEIGHT, 0, 0)
    this.enemyContainer.setPosition(local.x, local.y)
  }

  private updateEnemyHpDisplay() {
    this.enemyHpText?.setText(`${this.enemyHp}/${ENEMY_MAX_HP}`)
  }

  private attemptAttack() {
    if (!this.enemyAlive) {
      return
    }

    const distance = chebyshevDistance(this.heroTile, this.enemyTile)
    const { selectedClassId, attributes } = useCharacterStore.getState()
    const classDef = CLASS_DEFINITIONS[selectedClassId]

    if (distance > classDef.attackRange) {
      return
    }

    const derived = computeDerivedStats(attributes)
    const attackIntervalMs = 1000 / derived.attackSpeed
    const now = this.time.now

    // On-cooldown inputs are simply dropped (not queued) — simplest option that still
    // respects the fixed attack-speed interval from the stats system.
    if (now - this.lastAttackAt < attackIntervalMs) {
      return
    }

    this.lastAttackAt = now

    // PLACEHOLDER damage formula: raw Physical Attack applied directly as damage, no
    // mitigation (the enemy has no Defense stat yet). Real damage formula is unresolved
    // per CLAUDE.md. Note this only wires up physical basic attacks — a Spirit-based
    // class like Wuxia will deal 0 damage here until magic-based attacks are in scope.
    const damage = derived.physicalAttack
    this.dealDamageToEnemy(damage)
  }

  private dealDamageToEnemy(damage: number) {
    if (!this.enemyAlive || !this.enemyContainer) {
      return
    }

    this.enemyHp = Math.max(0, this.enemyHp - damage)
    this.updateEnemyHpDisplay()
    this.showFloatingDamage(damage)

    if (this.enemyHp <= 0) {
      this.killEnemy()
    }
  }

  private showFloatingDamage(damage: number) {
    if (!this.tileContainer || !this.enemyContainer) {
      return
    }

    // Positioned in absolute scene space (not parented to the enemy/tile containers)
    // so it survives the enemy dying or the tile container rebuilding mid-fade.
    const worldX = this.tileContainer.x + this.enemyContainer.x
    const worldY = this.tileContainer.y + this.enemyContainer.y - ENEMY_BOX_HEIGHT

    const text = this.add
      .text(worldX, worldY, `-${damage}`, {
        fontSize: '18px',
        color: '#fde047',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 1)
      .setDepth(2000)

    this.tweens.add({
      targets: text,
      y: worldY - FLOATING_TEXT_RISE_PX,
      alpha: 0,
      duration: FLOATING_TEXT_DURATION_MS,
      ease: 'Cubic.Out',
      onComplete: () => text.destroy(),
    })
  }

  private killEnemy() {
    this.enemyAlive = false
    const container = this.enemyContainer
    this.enemyContainer = undefined
    this.enemyHpText = undefined

    if (container) {
      this.tweens.add({
        targets: container,
        alpha: 0,
        scaleX: 0.6,
        scaleY: 0.6,
        duration: 300,
        ease: 'Cubic.In',
        onComplete: () => container.destroy(true),
      })
    }

    // Respawning on a timer is a temporary testing convenience so combat can be
    // re-tested without a page reload — not real zone/spawn design, which is a
    // separate, later step.
    this.time.delayedCall(ENEMY_RESPAWN_DELAY_MS, () => this.spawnEnemy())
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
