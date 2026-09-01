import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => boolean | void
  theme?: 'light' | 'dark' | 'auto'
  execution?: 'render' | 'execute'
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
      execute: (widgetId: string) => void
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Turnstile script'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

export interface TurnstileHandle {
  reset: () => void
}

interface TurnstileProps {
  onVerify: (token: string) => void
  onExpire?: () => void
}

// Mounted once per form and left alone across re-renders (email/password
// keystrokes shouldn't reset the widget) -- callbacks are read via ref so the
// render effect below can run with an empty dep array.
const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(({ onVerify, onExpire }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onVerifyRef = useRef(onVerify)
  const onExpireRef = useRef(onExpire)
  const needsExecuteRef = useRef(true)

  useEffect(() => {
    onVerifyRef.current = onVerify
    onExpireRef.current = onExpire
  }, [onVerify, onExpire])

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
      // execution:'execute' means reset() alone won't re-verify -- the next
      // gesture listener firing needs to know it must call execute() again.
      needsExecuteRef.current = true
    },
  }))

  useEffect(() => {
    if (!SITE_KEY) return

    let cancelled = false
    let cleanupGestureListeners: (() => void) | undefined

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          execution: 'execute',
          callback: (token) => {
            needsExecuteRef.current = false
            onVerifyRef.current(token)
          },
          'expired-callback': () => {
            needsExecuteRef.current = true
            onExpireRef.current?.()
          },
          'error-callback': () => {
            needsExecuteRef.current = true
            onExpireRef.current?.()
            return true
          },
          theme: 'dark',
        })

        // Safari's Storage Access API (needed under "Prevent Cross-Site
        // Tracking"/ITP) only grants access when requested synchronously
        // inside a real user gesture. Turnstile's default auto-render mode
        // starts verifying on mount with no gesture behind it, so on Safari
        // it silently fails and the widget collapses to blank. Deferring via
        // execution:'execute' and firing that from the page's first
        // pointer/key interaction gives it one.
        const runExecute = () => {
          if (needsExecuteRef.current && widgetIdRef.current && window.turnstile) {
            window.turnstile.execute(widgetIdRef.current)
          }
        }
        document.addEventListener('pointerdown', runExecute)
        document.addEventListener('keydown', runExecute)
        cleanupGestureListeners = () => {
          document.removeEventListener('pointerdown', runExecute)
          document.removeEventListener('keydown', runExecute)
        }
      })
      .catch(() => {
        // Widget silently fails to appear; handleSubmit's missing-token check
        // still blocks submission, so this just shows as a stuck form.
      })

    return () => {
      cancelled = true
      cleanupGestureListeners?.()
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
      }
    }
  }, [])

  if (!SITE_KEY) return null

  return <div ref={containerRef} />
})

Turnstile.displayName = 'Turnstile'

export default Turnstile
