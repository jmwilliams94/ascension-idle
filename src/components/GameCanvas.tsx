import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import IsometricScene from '../game/scenes/IsometricScene'

export default function GameCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return undefined
    }

    const parent = containerRef.current
    const width = parent.clientWidth || 960
    const height = parent.clientHeight || 640

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width,
      height,
      backgroundColor: '#020617',
      scale: {
        mode: Phaser.Scale.RESIZE,
        parent,
        width,
        height,
        // Floors every size calculation to a whole pixel. Without this, RESIZE mode
        // can accumulate fractional-pixel growth across repeated resize events.
        autoRound: true,
      },
      scene: [IsometricScene],
    })

    return () => {
      game.destroy(true)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="h-[640px] w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl shadow-slate-950/40"
      aria-label="Phaser game canvas"
    />
  )
}
