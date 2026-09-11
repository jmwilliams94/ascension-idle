import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Grid, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useLockBodyScroll } from '../../lib/useLockBodyScroll'

// Greybox prototype #2 (2026-09-12, requested by the user) -- the Archero-
// style alternative: simple 3D primitives, top-down-angled follow camera,
// free WASD movement, auto-fire at the nearest enemy. Deliberately dumb
// combat/spawn logic (no real damage formulas, no drops) -- this exists only
// to test whether the camera/movement *feel* is right before any art or
// real mechanics are attached. Not gameplay UI -- see GreyboxPanel.tsx.

interface EnemyState {
  id: number
  x: number
  z: number
  hp: number
  maxHp: number
  wanderAngle: number
  wanderCenter: [number, number]
}

interface ProjectileState {
  id: number
  x: number
  z: number
  targetId: number
}

interface LootTextState {
  id: number
  x: number
  z: number
  text: string
  born: number
}

interface World {
  enemies: EnemyState[]
  projectiles: ProjectileState[]
  lootTexts: LootTextState[]
  lastSpawn: number
  lastAttack: number
  gold: number
}

const ARENA_SIZE = 24
const PLAYER_SPEED = 6
const ENEMY_SPAWN_INTERVAL_MS = 2500
const MAX_ENEMIES = 8
const ATTACK_RANGE = 7
const ATTACK_INTERVAL_MS = 700
const PROJECTILE_SPEED = 14
const LOOT_TEXT_LIFETIME_MS = 900

let idCounter = 1
const nextId = () => idCounter++

function randomArenaPoint(): [number, number] {
  const r = ARENA_SIZE / 2 - 2
  return [(Math.random() * 2 - 1) * r, (Math.random() * 2 - 1) * r]
}

function Player({ posRef }: { posRef: MutableRefObject<THREE.Vector3> }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const keys = useRef<Set<string>>(new Set())

  useEffect(() => {
    const down = (event: KeyboardEvent) => keys.current.add(event.code)
    const up = (event: KeyboardEvent) => keys.current.delete(event.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame((_, delta) => {
    const pressed = keys.current
    let dx = 0
    let dz = 0
    if (pressed.has('ArrowUp') || pressed.has('KeyW')) dz -= 1
    if (pressed.has('ArrowDown') || pressed.has('KeyS')) dz += 1
    if (pressed.has('ArrowLeft') || pressed.has('KeyA')) dx -= 1
    if (pressed.has('ArrowRight') || pressed.has('KeyD')) dx += 1
    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz)
      const bound = ARENA_SIZE / 2 - 1
      posRef.current.x = THREE.MathUtils.clamp(posRef.current.x + (dx / len) * PLAYER_SPEED * delta, -bound, bound)
      posRef.current.z = THREE.MathUtils.clamp(posRef.current.z + (dz / len) * PLAYER_SPEED * delta, -bound, bound)
    }
    meshRef.current?.position.set(posRef.current.x, 1, posRef.current.z)
  })

  return (
    <mesh ref={meshRef} castShadow>
      <capsuleGeometry args={[0.5, 1, 4, 8]} />
      <meshStandardMaterial color="#f5c542" />
    </mesh>
  )
}

function CameraRig({ posRef }: { posRef: MutableRefObject<THREE.Vector3> }) {
  const { camera } = useThree()
  const target = useRef(new THREE.Vector3())
  useFrame(() => {
    target.current.set(posRef.current.x, 10, posRef.current.z + 9)
    camera.position.lerp(target.current, 0.08)
    camera.lookAt(posRef.current.x, 0, posRef.current.z)
  })
  return null
}

function EnemyMesh({ enemy }: { enemy: EnemyState }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 0.6 + Math.sin(clock.elapsedTime * 2 + enemy.id) * 0.08
  })
  const hpPct = enemy.hp / enemy.maxHp
  return (
    <group position={[enemy.x, 0, enemy.z]}>
      <mesh ref={ref} castShadow>
        <boxGeometry args={[1, 1.2, 1]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      <Billboard position={[0, 1.6, 0]}>
        <mesh>
          <planeGeometry args={[1, 0.12]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.6} />
        </mesh>
        <mesh position={[-((1 - hpPct) / 2), 0, 0.01]} scale={[Math.max(0.001, hpPct), 1, 1]}>
          <planeGeometry args={[1, 0.12]} />
          <meshBasicMaterial color="#e74c3c" />
        </mesh>
      </Billboard>
    </group>
  )
}

function LootTextMesh({ loot }: { loot: LootTextState }) {
  const age = Date.now() - loot.born
  const t = Math.min(1, age / LOOT_TEXT_LIFETIME_MS)
  return (
    <Billboard position={[loot.x, 1.6 + t * 1.2, loot.z]}>
      <Text fontSize={0.5} color="#facc15" anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="#000000" fillOpacity={1 - t}>
        {loot.text}
      </Text>
    </Billboard>
  )
}

function GameLoop({
  playerPosRef,
  worldRef,
  forceRender,
}: {
  playerPosRef: MutableRefObject<THREE.Vector3>
  worldRef: MutableRefObject<World>
  forceRender: () => void
}) {
  useFrame((_, delta) => {
    const world = worldRef.current
    const now = performance.now()

    if (now - world.lastSpawn > ENEMY_SPAWN_INTERVAL_MS && world.enemies.length < MAX_ENEMIES) {
      world.lastSpawn = now
      const [x, z] = randomArenaPoint()
      world.enemies.push({ id: nextId(), x, z, hp: 3, maxHp: 3, wanderAngle: Math.random() * Math.PI * 2, wanderCenter: [x, z] })
    }

    for (const enemy of world.enemies) {
      enemy.wanderAngle += delta * 0.3
      enemy.x = enemy.wanderCenter[0] + Math.cos(enemy.wanderAngle) * 1.5
      enemy.z = enemy.wanderCenter[1] + Math.sin(enemy.wanderAngle) * 1.5
    }

    if (now - world.lastAttack > ATTACK_INTERVAL_MS) {
      const player = playerPosRef.current
      let nearest: EnemyState | null = null
      let bestDist = ATTACK_RANGE
      for (const enemy of world.enemies) {
        const dist = Math.hypot(enemy.x - player.x, enemy.z - player.z)
        if (dist < bestDist) {
          bestDist = dist
          nearest = enemy
        }
      }
      if (nearest) {
        world.lastAttack = now
        world.projectiles.push({ id: nextId(), x: player.x, z: player.z, targetId: nearest.id })
      }
    }

    world.projectiles = world.projectiles.filter((projectile) => {
      const target = world.enemies.find((enemy) => enemy.id === projectile.targetId)
      if (!target) return false
      const dx = target.x - projectile.x
      const dz = target.z - projectile.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.5) {
        target.hp -= 1
        if (target.hp <= 0) {
          const gold = 5 + Math.floor(Math.random() * 15)
          world.gold += gold
          world.lootTexts.push({ id: nextId(), x: target.x, z: target.z, text: `+${gold} Gold`, born: performance.now() })
        }
        return false
      }
      projectile.x += (dx / dist) * PROJECTILE_SPEED * delta
      projectile.z += (dz / dist) * PROJECTILE_SPEED * delta
      return true
    })

    world.enemies = world.enemies.filter((enemy) => enemy.hp > 0)
    world.lootTexts = world.lootTexts.filter((loot) => performance.now() - loot.born < LOOT_TEXT_LIFETIME_MS)

    forceRender()
  })
  return null
}

export default function ArcheroGreybox({ onExit }: { onExit: () => void }) {
  useLockBodyScroll()
  const playerPosRef = useRef(new THREE.Vector3(0, 1, 6))
  const worldRef = useRef<World>({ enemies: [], projectiles: [], lootTexts: [], lastSpawn: 0, lastAttack: 0, gold: 0 })
  const [, setTick] = useState(0)
  const forceRender = () => setTick((tick) => (tick + 1) % 1_000_000)

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onExit])

  const world = worldRef.current

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-950">
      <Canvas shadows camera={{ position: [0, 10, 15], fov: 50 }}>
        <color attach="background" args={['#0b0f19']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 12, 4]} intensity={1.1} castShadow />
        <Grid args={[ARENA_SIZE, ARENA_SIZE]} cellColor="#2c3555" sectionColor="#3a4568" fadeDistance={30} position={[0, 0.01, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[ARENA_SIZE, ARENA_SIZE]} />
          <meshStandardMaterial color="#141a2b" />
        </mesh>
        <Player posRef={playerPosRef} />
        <CameraRig posRef={playerPosRef} />
        {world.enemies.map((enemy) => (
          <EnemyMesh key={enemy.id} enemy={enemy} />
        ))}
        {world.projectiles.map((projectile) => (
          <mesh key={projectile.id} position={[projectile.x, 1, projectile.z]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
        ))}
        {world.lootTexts.map((loot) => (
          <LootTextMesh key={loot.id} loot={loot} />
        ))}
        <GameLoop playerPosRef={playerPosRef} worldRef={worldRef} forceRender={forceRender} />
      </Canvas>

      <div className="pointer-events-none absolute left-5 top-5 text-lg font-bold text-amber-400">Gold: {world.gold}</div>
      <p className="pointer-events-none absolute bottom-5 left-5 text-xs text-slate-400">
        WASD / arrows to move · auto-attacks the nearest enemy
      </p>
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
