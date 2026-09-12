import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLockBodyScroll } from '../../lib/useLockBodyScroll'
import { loadSpriteSheet, type SpriteSheet } from './sprite/spriteSheet'
import { createAnimatorState, currentFrameRect, setAnimatorTag, stepAnimator } from './sprite/spriteAnimator'

// Greybox prototype #1 (2026-09-12, requested by the user) -- a 2.5D-feel
// side-scroller: parallax depth layers, jump/move platforming, click an
// enemy within melee range to kill it for gold + a burst of "loot beans".
// Pure Canvas2D -- this is only for feeling out whether manual
// jump-around-and-kill combat is fun before any of it is wired to real game
// state. Not gameplay UI -- see GreyboxPanel.tsx.
//
// Character is a real animated sprite now (2026-09-12) -- the base
// "undergarment"/no-gear look, drawn in Aseprite at 32x48px (2:3, per the
// user) with idle/walk/jump/fall/attack tags, exported to
// public/greybox/character-base.png(+.json). Gear-layer sprites (weapon/
// coat/hat) are a deliberately separate, later step -- see the
// project_greybox_combat_prototypes memory. Drawn with
// `ctx.imageSmoothingEnabled = false` and an integer SPRITE_SCALE for crisp
// pixels, rather than the full fixed-virtual-resolution+letterbox approach
// discussed for this project -- that's a bigger change to how this canvas
// sizes itself (currently 1:1 with the real viewport, like the parallax/
// enemy rendering already here) and wasn't needed just to prove the
// animation pipeline; revisit if real-device testing shows sizing issues.

const SPRITE_FRAME_WIDTH = 32
const SPRITE_FRAME_HEIGHT = 48
const SPRITE_SCALE = 3
const PLAYER_WIDTH = SPRITE_FRAME_WIDTH * SPRITE_SCALE
const PLAYER_HEIGHT = SPRITE_FRAME_HEIGHT * SPRITE_SCALE
const ATTACK_ANIM_DURATION_MS = 300

interface Enemy {
  id: number
  x: number
  dir: number
  patrolCenter: number
  hp: number
  maxHp: number
}

interface LootBean {
  x: number
  y: number
  vx: number
  vy: number
  born: number
}

interface LootText {
  x: number
  y: number
  text: string
  born: number
}

const GRAVITY = 1800
const MOVE_SPEED = 320
const JUMP_VELOCITY = -720
const GROUND_Y = 460
const LEVEL_WIDTH = 4000
const ATTACK_RANGE = 70
const ATTACK_COOLDOWN_MS = 350
const ENEMY_SIZE = 30
const ENEMY_SPAWN_INTERVAL_MS = 2200
const MAX_ENEMIES = 10
const LOOT_BEAN_LIFETIME_MS = 700
const LOOT_TEXT_LIFETIME_MS = 900

let nextEnemyId = 1

function drawParallaxLayer(
  ctx: CanvasRenderingContext2D,
  offset: number,
  width: number,
  baseY: number,
  color: string,
  blockWidth: number,
  blockHeight: number,
) {
  ctx.fillStyle = color
  const start = -((offset % blockWidth) + blockWidth)
  for (let x = start; x < width + blockWidth; x += blockWidth) {
    ctx.fillRect(x, baseY, blockWidth - 10, blockHeight)
  }
}

export default function SideScrollerGreybox({ onExit }: { onExit: () => void }) {
  useLockBodyScroll()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    // Reassigned to explicitly-non-null-typed locals -- TS's control-flow
    // narrowing from the checks above doesn't carry into the `loop` closure
    // defined further down, so without this every ctx/canvas use inside it
    // errors as "possibly null" even though the check already ran.
    const canvas: HTMLCanvasElement = canvasEl
    const context = canvas.getContext('2d')
    if (!context) return
    const ctx: CanvasRenderingContext2D = context

    let width = window.innerWidth
    let height = window.innerHeight
    canvas.width = width
    canvas.height = height

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width
      canvas.height = height
    }
    window.addEventListener('resize', resize)

    const keys = new Set<string>()
    const onKeyDown = (event: KeyboardEvent) => keys.add(event.code)
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const player = { x: 200, y: GROUND_Y - PLAYER_HEIGHT, vy: 0, onGround: true, facing: 1, lastAttack: 0 }
    let sheet: SpriteSheet | null = null
    const animator = createAnimatorState('idle')
    loadSpriteSheet('/greybox/character-base.json')
      .then((loaded) => {
        sheet = loaded
      })
      .catch((error) => console.error('[Greybox] failed to load character sprite', error))
    let cameraX = 0
    let enemies: Enemy[] = []
    let lootBeans: LootBean[] = []
    let lootTexts: LootText[] = []
    let lastSpawn = 0
    let goldTotal = 0

    function spawnEnemy(atX: number) {
      enemies.push({ id: nextEnemyId++, x: atX, dir: Math.random() > 0.5 ? 1 : -1, patrolCenter: atX, hp: 3, maxHp: 3 })
    }

    for (let i = 0; i < 4; i++) spawnEnemy(500 + i * 500)

    function onClick(event: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const clickX = event.clientX - rect.left + cameraX
      const clickY = event.clientY - rect.top
      const now = performance.now()
      if (now - player.lastAttack < ATTACK_COOLDOWN_MS) return

      let target: Enemy | null = null
      let bestDist = Infinity
      for (const enemy of enemies) {
        const withinClick = Math.abs(clickX - enemy.x) < ENEMY_SIZE && Math.abs(clickY - (GROUND_Y - ENEMY_SIZE / 2)) < ENEMY_SIZE * 1.5
        if (!withinClick) continue
        const distToPlayer = Math.abs(enemy.x - player.x)
        if (distToPlayer > ATTACK_RANGE || distToPlayer >= bestDist) continue
        bestDist = distToPlayer
        target = enemy
      }
      if (!target) return

      player.lastAttack = now
      target.hp -= 1
      if (target.hp > 0) return

      enemies = enemies.filter((enemy) => enemy.id !== target!.id)
      const gold = 5 + Math.floor(Math.random() * 15)
      goldTotal += gold
      lootTexts.push({ x: target.x, y: GROUND_Y - ENEMY_SIZE, text: `+${gold} Gold`, born: now })
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6
        lootBeans.push({
          x: target.x,
          y: GROUND_Y - ENEMY_SIZE,
          vx: Math.cos(angle) * 140,
          vy: Math.sin(angle) * 140 - 200,
          born: now,
        })
      }
    }
    canvas.addEventListener('click', onClick)

    let raf = 0

    function loop(time: number, prevTime: number) {
      const dt = Math.min(0.05, (time - prevTime) / 1000)

      if (keys.has('ArrowLeft') || keys.has('KeyA')) {
        player.x -= MOVE_SPEED * dt
        player.facing = -1
      }
      if (keys.has('ArrowRight') || keys.has('KeyD')) {
        player.x += MOVE_SPEED * dt
        player.facing = 1
      }
      player.x = Math.max(30, Math.min(LEVEL_WIDTH - 30, player.x))
      if ((keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW')) && player.onGround) {
        player.vy = JUMP_VELOCITY
        player.onGround = false
      }

      player.vy += GRAVITY * dt
      player.y += player.vy * dt
      if (player.y >= GROUND_Y - PLAYER_HEIGHT) {
        player.y = GROUND_Y - PLAYER_HEIGHT
        player.vy = 0
        player.onGround = true
      }

      const isMovingHorizontally = keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('ArrowRight') || keys.has('KeyD')
      const isAttacking = time - player.lastAttack < ATTACK_ANIM_DURATION_MS
      const animTag = isAttacking ? 'attack' : !player.onGround ? (player.vy < 0 ? 'jump' : 'fall') : isMovingHorizontally ? 'walk' : 'idle'
      setAnimatorTag(animator, animTag)
      if (sheet) stepAnimator(sheet, animator, dt * 1000)

      cameraX = Math.max(0, Math.min(LEVEL_WIDTH - width, player.x - width / 2))

      for (const enemy of enemies) {
        enemy.x += enemy.dir * 40 * dt
        if (Math.abs(enemy.x - enemy.patrolCenter) > 80) enemy.dir *= -1
      }

      if (time - lastSpawn > ENEMY_SPAWN_INTERVAL_MS && enemies.length < MAX_ENEMIES) {
        lastSpawn = time
        const side = Math.random() > 0.5 ? 1 : -1
        spawnEnemy(Math.max(60, Math.min(LEVEL_WIDTH - 60, player.x + side * (400 + Math.random() * 300))))
      }

      lootBeans = lootBeans.filter((bean) => time - bean.born < LOOT_BEAN_LIFETIME_MS)
      for (const bean of lootBeans) {
        bean.vy += GRAVITY * 0.6 * dt
        bean.x += bean.vx * dt
        bean.y += bean.vy * dt
      }
      lootTexts = lootTexts.filter((text) => time - text.born < LOOT_TEXT_LIFETIME_MS)

      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#0b0f19'
      ctx.fillRect(0, 0, width, height)

      drawParallaxLayer(ctx, cameraX * 0.2, width, GROUND_Y - 220, '#1c2438', 260, 140)
      drawParallaxLayer(ctx, cameraX * 0.5, width, GROUND_Y - 120, '#232c46', 160, 90)
      drawParallaxLayer(ctx, cameraX * 0.8, width, GROUND_Y - 40, '#2c3555', 90, 50)

      ctx.fillStyle = '#161b2c'
      ctx.fillRect(0, GROUND_Y, width, height - GROUND_Y)
      ctx.strokeStyle = '#3a4568'
      ctx.beginPath()
      ctx.moveTo(0, GROUND_Y)
      ctx.lineTo(width, GROUND_Y)
      ctx.stroke()

      for (const enemy of enemies) {
        const sx = enemy.x - cameraX
        if (sx < -60 || sx > width + 60) continue
        ctx.fillStyle = '#c0392b'
        ctx.fillRect(sx - ENEMY_SIZE / 2, GROUND_Y - ENEMY_SIZE, ENEMY_SIZE, ENEMY_SIZE)
        const hpPct = enemy.hp / enemy.maxHp
        ctx.fillStyle = '#000'
        ctx.fillRect(sx - ENEMY_SIZE / 2, GROUND_Y - ENEMY_SIZE - 10, ENEMY_SIZE, 5)
        ctx.fillStyle = '#e74c3c'
        ctx.fillRect(sx - ENEMY_SIZE / 2, GROUND_Y - ENEMY_SIZE - 10, ENEMY_SIZE * hpPct, 5)
      }

      const psx = player.x - cameraX
      const frame = sheet ? currentFrameRect(sheet, animator) : null
      if (sheet && frame) {
        ctx.imageSmoothingEnabled = false
        ctx.save()
        if (player.facing < 0) {
          ctx.translate(psx, 0)
          ctx.scale(-1, 1)
          ctx.drawImage(sheet.image, frame.x, frame.y, frame.w, frame.h, -PLAYER_WIDTH / 2, player.y, PLAYER_WIDTH, PLAYER_HEIGHT)
        } else {
          ctx.drawImage(sheet.image, frame.x, frame.y, frame.w, frame.h, psx - PLAYER_WIDTH / 2, player.y, PLAYER_WIDTH, PLAYER_HEIGHT)
        }
        ctx.restore()
      } else {
        // Fallback while the sprite sheet is still loading (first frame or two).
        ctx.fillStyle = '#f5c542'
        ctx.fillRect(psx - PLAYER_WIDTH / 2, player.y, PLAYER_WIDTH, PLAYER_HEIGHT)
      }

      for (const bean of lootBeans) {
        const alpha = Math.max(0, 1 - (time - bean.born) / LOOT_BEAN_LIFETIME_MS)
        ctx.fillStyle = `rgba(250, 204, 21, ${alpha})`
        ctx.beginPath()
        ctx.arc(bean.x - cameraX, bean.y, 4, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'center'
      for (const text of lootTexts) {
        const age = time - text.born
        const alpha = Math.max(0, 1 - age / LOOT_TEXT_LIFETIME_MS)
        ctx.fillStyle = `rgba(250, 204, 21, ${alpha})`
        ctx.fillText(text.text, text.x - cameraX, text.y - 20 - age / 20)
      }

      ctx.textAlign = 'left'
      ctx.fillStyle = '#f5c542'
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText(`Gold: ${goldTotal}`, 20, 32)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '13px sans-serif'
      ctx.fillText('A/D or ←/→ move · Space/W jump · click a nearby enemy to attack', 20, height - 20)

      raf = requestAnimationFrame((next) => loop(next, time))
    }
    raf = requestAnimationFrame((first) => loop(first, first))

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('click', onClick)
    }
  }, [])

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onExit])

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-950">
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" />
      <button
        type="button"
        onClick={onExit}
        className="absolute right-4 top-4 rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-200 hover:border-amber-500/60"
      >
        Exit (Esc)
      </button>
    </div>,
    document.body,
  )
}
