import { useEffect } from 'react'
import { useTabActivityStore } from '../lib/useTabActivityStore'

const ORIGINAL_TITLE = document.title
const FAVICON_HREF = '/favicon.png'
const BADGE_SIZE = 32

// Rasterizing favicon.png + drawing a badge dot onto it is genuinely async
// (Image.onload) and only ever needs doing once — cached at module scope so
// flipping pending on/off/on again doesn't redo the work.
let badgeIconPromise: Promise<string> | null = null

function loadBadgeIcon(): Promise<string> {
  if (!badgeIconPromise) {
    badgeIconPromise = new Promise((resolve) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = BADGE_SIZE
        canvas.height = BADGE_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(FAVICON_HREF)
          return
        }
        ctx.drawImage(image, 0, 0, BADGE_SIZE, BADGE_SIZE)
        ctx.beginPath()
        ctx.arc(BADGE_SIZE - 7, 7, 6, 0, Math.PI * 2)
        ctx.fillStyle = '#ef4444'
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#0b0f19'
        ctx.stroke()
        resolve(canvas.toDataURL('image/png'))
      }
      // Image failed to rasterize (unlikely, but favicon.png is same-origin) —
      // fall back to the plain unbadged icon rather than leaving the tab with
      // a broken favicon.
      image.onerror = () => resolve(FAVICON_HREF)
      image.src = FAVICON_HREF
    })
  }
  return badgeIconPromise
}

// Non-visual — flips the browser tab's title/favicon to a noticeable
// "something happened" state whenever a live Realtime event (mail, World
// Boss, Gold Donation, a global announcement) arrives while this tab is
// hidden, mirroring TabActivityStore's own doc comment. Clears the instant
// the tab regains focus. Mounted once in GameShell alongside the other
// non-visual connection components.
export default function TabActivityIndicator() {
  const pending = useTabActivityStore((state) => state.pending)
  const clear = useTabActivityStore((state) => state.clear)

  useEffect(() => {
    const handleVisible = () => {
      if (!document.hidden) {
        clear()
      }
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)
    return () => {
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
  }, [clear])

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')

    if (!pending) {
      document.title = ORIGINAL_TITLE
      if (link) {
        link.href = FAVICON_HREF
      }
      return
    }

    document.title = `🔔 ${ORIGINAL_TITLE}`
    if (link) {
      let cancelled = false
      void loadBadgeIcon().then((href) => {
        if (!cancelled) {
          link.href = href
        }
      })
      return () => {
        cancelled = true
      }
    }
    return undefined
  }, [pending])

  return null
}
