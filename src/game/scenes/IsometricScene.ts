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
import { useProgressionStore } from '../stats/useProgressionStore'
import {
  ENEMY_SPAWNS,
  ENEMY_TYPES,
  type EnemySpawnDef,
  type EnemyTypeDef,
  type EnemyTypeId,
} from '../zones/twincrossOutskirts'

type TileMarker = {
  graphic: Phaser.GameObjects.Graphics
  coord: TileCoord
}

interface EnemyInstance {
  id: string
  typeId: EnemyTypeId
  tile: TileCoord
  hp: number
  alive: boolean
  container?: Phaser.GameObjects.Container
  hpText?: Phaser.GameObjects.Text
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

// Testing convenience only — a few seconds so re-testing doesn't need a page reload.
// Not real zone/spawn design (see spawnEnemy/killEnemy).
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
  // The tile the world is currently rendered relative to — same as heroTile except
  // mid-move, when buildVisibleTiles has already re-centered on the destination tile
  // but heroTile itself doesn't update until the move animation completes. Anything
  // that positions a new object into the world (e.g. a respawning enemy) must use
  // this, not heroTile, or it'll be placed relative to a tile that's about to change
  // out from under it and appear to jump on the next move.
  private renderCenterTile: TileCoord = { x: 50, y: 50 }

  private enemies = new Map<string, EnemyInstance>()
  private lastAttackAt = -Infinity
  // Id of the enemy the player clicked — drives the auto-approach/auto-attack loop in
  // update(). Cleared by clicking elsewhere, clicking a different enemy, or the
  // engaged enemy dying.
  private engagedEnemyId: string | null = null

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
    this.initEnemies()

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

      const clickedEnemy = this.findAliveEnemyAt(targetTile)

      if (clickedEnemy) {
        // Engage: update() will approach (if needed) and then auto-attack every
        // interval until this enemy dies or a different click cancels engagement.
        this.engagedEnemyId = clickedEnemy.id
        this.attemptAttack()
        return
      }

      this.engagedEnemyId = null
      this.moveToTile(targetTile)
    })
  }

  update() {
    if (!this.engagedEnemyId) {
      return
    }

    const enemy = this.enemies.get(this.engagedEnemyId)

    if (!enemy || !enemy.alive) {
      return
    }

    const distance = chebyshevDistance(this.heroTile, enemy.tile)
    const { selectedClassId } = useCharacterStore.getState()
    const classDef = CLASS_DEFINITIONS[selectedClassId]

    if (distance > classDef.attackRange) {
      if (!this.isMoving) {
        this.stepToward(enemy.tile)
      }
      return
    }

    this.attemptAttack()
  }

  private findAliveEnemyAt(tile: TileCoord): EnemyInstance | undefined {
    for (const enemy of this.enemies.values()) {
      if (enemy.alive && enemy.tile.x === tile.x && enemy.tile.y === tile.y) {
        return enemy
      }
    }

    return undefined
  }

  // Greedily moves one tile closer (diagonals count as one step, matching
  // chebyshevDistance) — enough for a single stationary target with no obstacles.
  private stepToward(target: TileCoord) {
    const stepX = Math.sign(target.x - this.heroTile.x)
    const stepY = Math.sign(target.y - this.heroTile.y)
    this.moveToTile({ x: this.heroTile.x + stepX, y: this.heroTile.y + stepY })
  }

  private buildVisibleTiles(centerTile: TileCoord = this.heroTile, initialOffset?: { x: number; y: number }) {
    if (!this.tileContainer) {
      return
    }

    this.renderCenterTile = centerTile

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

    // Detach (don't destroy) each enemy before wiping the container's children below —
    // they're re-added and repositioned relative to the new center tile further down.
    this.enemies.forEach((enemy) => {
      if (enemy.container) {
        this.tileContainer!.remove(enemy.container)
      }
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

    this.enemies.forEach((enemy) => {
      if (enemy.alive && enemy.container) {
        this.positionEnemy(enemy, centerTile)
        this.tileContainer!.add(enemy.container)
      }
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

  // Populates the zone's fixed enemy roster (see ../zones/twincrossOutskirts). Each
  // spawn point gets its own stationary, non-aggro instance — still a placeholder
  // combat model (no movement/aggro/attacking back), just several of them now.
  private initEnemies() {
    ENEMY_SPAWNS.forEach((spawn) => {
      this.enemies.set(spawn.id, {
        id: spawn.id,
        typeId: spawn.typeId,
        tile: spawn.tile,
        hp: 0,
        alive: false,
      })
      this.spawnEnemy(spawn)
    })
  }

  private spawnEnemy(spawn: EnemySpawnDef) {
    const enemy = this.enemies.get(spawn.id)

    if (!enemy) {
      return
    }

    const type = ENEMY_TYPES[spawn.typeId]

    enemy.hp = type.maxHp
    enemy.alive = true
    enemy.container = this.add.container(0, 0, this.buildEnemyBox(type))
    enemy.hpText = this.add
      .text(0, -ENEMY_BOX_HEIGHT - ENEMY_HALF_DEPTH - 16, '', {
        fontSize: '13px',
        color: '#fca5a5',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 1)
    enemy.container.add(enemy.hpText)
    this.updateEnemyHpDisplay(enemy)

    this.positionEnemy(enemy, this.renderCenterTile)
    this.tileContainer?.add(enemy.container)
  }

  private buildEnemyBox(type: EnemyTypeDef) {
    const hw = ENEMY_HALF_WIDTH
    const hd = ENEMY_HALF_DEPTH
    const height = ENEMY_BOX_HEIGHT

    // Same shaded-box construction as the hero, tinted per enemy type so the roster
    // reads as distinct targets rather than clones.
    const topFace = this.add.graphics()
    topFace.fillStyle(type.bodyColor.top, 1)
    topFace.beginPath()
    topFace.moveTo(0, -hd - height)
    topFace.lineTo(hw, -height)
    topFace.lineTo(0, hd - height)
    topFace.lineTo(-hw, -height)
    topFace.closePath()
    topFace.fillPath()

    const rightFace = this.add.graphics()
    rightFace.fillStyle(type.bodyColor.right, 1)
    rightFace.beginPath()
    rightFace.moveTo(0, hd)
    rightFace.lineTo(hw, 0)
    rightFace.lineTo(hw, -height)
    rightFace.lineTo(0, hd - height)
    rightFace.closePath()
    rightFace.fillPath()

    const leftFace = this.add.graphics()
    leftFace.fillStyle(type.bodyColor.left, 1)
    leftFace.beginPath()
    leftFace.moveTo(0, hd)
    leftFace.lineTo(-hw, 0)
    leftFace.lineTo(-hw, -height)
    leftFace.lineTo(0, hd - height)
    leftFace.closePath()
    leftFace.fillPath()

    return [topFace, rightFace, leftFace]
  }

  private positionEnemy(enemy: EnemyInstance, centerTile: TileCoord) {
    if (!enemy.container) {
      return
    }

    const relative = { x: enemy.tile.x - centerTile.x, y: enemy.tile.y - centerTile.y }
    const local = tileToWorld(relative, TILE_WIDTH, TILE_HEIGHT, 0, 0)
    enemy.container.setPosition(local.x, local.y)
  }

  private updateEnemyHpDisplay(enemy: EnemyInstance) {
    const maxHp = ENEMY_TYPES[enemy.typeId].maxHp
    enemy.hpText?.setText(`${enemy.hp}/${maxHp}`)
  }

  private attemptAttack() {
    if (!this.engagedEnemyId) {
      return
    }

    const enemy = this.enemies.get(this.engagedEnemyId)

    if (!enemy || !enemy.alive) {
      return
    }

    const distance = chebyshevDistance(this.heroTile, enemy.tile)
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
    // mitigation (enemies have no Defense stat yet). Real damage formula is unresolved
    // per CLAUDE.md. Note this only wires up physical basic attacks — a Spirit-based
    // class like Wuxia will deal 0 damage here until magic-based attacks are in scope.
    const damage = derived.physicalAttack
    this.dealDamageToEnemy(enemy, damage)
  }

  private dealDamageToEnemy(enemy: EnemyInstance, damage: number) {
    if (!enemy.alive || !enemy.container) {
      return
    }

    enemy.hp = Math.max(0, enemy.hp - damage)
    this.updateEnemyHpDisplay(enemy)
    this.showFloatingDamage(enemy, damage)

    if (enemy.hp <= 0) {
      this.killEnemy(enemy)
    }
  }

  private showFloatingDamage(enemy: EnemyInstance, damage: number) {
    if (!this.tileContainer || !enemy.container) {
      return
    }

    // Positioned in absolute scene space (not parented to the enemy/tile containers)
    // so it survives the enemy dying or the tile container rebuilding mid-fade.
    const worldX = this.tileContainer.x + enemy.container.x
    const worldY = this.tileContainer.y + enemy.container.y - ENEMY_BOX_HEIGHT

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

  private killEnemy(enemy: EnemyInstance) {
    enemy.alive = false

    if (this.engagedEnemyId === enemy.id) {
      this.engagedEnemyId = null
    }

    const container = enemy.container
    enemy.container = undefined
    enemy.hpText = undefined

    const type = ENEMY_TYPES[enemy.typeId]
    useProgressionStore.getState().addRewards(type.goldReward, type.expReward)

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
    const spawn: EnemySpawnDef = { id: enemy.id, typeId: enemy.typeId, tile: enemy.tile }
    this.time.delayedCall(ENEMY_RESPAWN_DELAY_MS, () => this.spawnEnemy(spawn))
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
