import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { recordEvent } from '../../lib/debugTrail'

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

// A cold PWA resume on iOS (WKWebView torn down while backgrounded, reopen =
// fresh page load) often races the network radio reconnecting -- the very
// first fetch of this script can fail with no user-visible sign of why.
// Failing the cached promise permanently would strand the login form with no
// Turnstile widget for the rest of the session, so a rejection clears the
// cache and lets the next call (retried below) try again from scratch.
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  const promise: Promise<void> = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Turnstile script'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    scriptPromise = null
    throw error
  })
  scriptPromise = promise

  return promise
}

const SCRIPT_RETRY_DELAYS_MS = [500, 1500, 3000]

// Waits out the backoff delay, but resolves early the moment the browser
// reports connectivity is back -- a fixed-only backoff was adding up to 10s
// of dead time (sum of the old, longer delays) right after a resume/reload,
// exactly when the network is most likely to reconnect mid-wait.
function waitForNextAttempt(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const onOnline = () => {
      clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      resolve()
    }
    const timer = setTimeout(() => {
      window.removeEventListener('online', onOnline)
      resolve()
    }, delayMs)
    window.addEventListener('online', onOnline)
  })
}

async function loadTurnstileScriptWithRetry(isCancelled: () => boolean): Promise<void> {
  for (const delay of SCRIPT_RETRY_DELAYS_MS) {
    try {
      await loadTurnstileScript()
      return
    } catch {
      if (isCancelled()) return
      await waitForNextAttempt(delay)
    }
  }
  return loadTurnstileScript()
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

    recordEvent('turnstile:script-load-start')

    loadTurnstileScriptWithRetry(() => cancelled)
      .then(() => {
        recordEvent('turnstile:script-loaded', `cancelled=${cancelled} hasContainer=${Boolean(containerRef.current)}`)
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          execution: 'execute',
          callback: (token) => {
            recordEvent('turnstile:verified', `tokenLen=${token.length}`)
            needsExecuteRef.current = false
            onVerifyRef.current(token)
          },
          'expired-callback': () => {
            recordEvent('turnstile:expired')
            needsExecuteRef.current = true
            onExpireRef.current?.()
          },
          'error-callback': () => {
            recordEvent('turnstile:error-callback')
            needsExecuteRef.current = true
            onExpireRef.current?.()
            return true
          },
          theme: 'dark',
        })
        recordEvent('turnstile:rendered', `widgetId=${widgetIdRef.current}`)

        // Safari's Storage Access API (needed under "Prevent Cross-Site
        // Tracking"/ITP) only grants access when requested synchronously
        // inside a real user gesture. Turnstile's default auto-render mode
        // starts verifying on mount with no gesture behind it, so on Safari
        // it silently fails and the widget collapses to blank. Deferring via
        // execution:'execute' and firing that from the page's first
        // pointer/key interaction gives it one.
        const runExecute = (event: Event) => {
          recordEvent('turnstile:gesture-fired', `type=${event.type} needsExecute=${needsExecuteRef.current}`)
          if (needsExecuteRef.current && widgetIdRef.current && window.turnstile) {
            // Flip immediately, not just on the verify callback -- previously
            // this stayed true until a token actually arrived, so every
            // touch/keypress before that (typing, tapping another field, etc.)
            // called execute() again on top of a still-in-flight attempt.
            // Debug trail evidence (2026-09-02): 7 execute() calls in ~2s on
            // one page load, each stacking a fresh Cloudflare challenge
            // without the previous one finishing or being torn down -- the
            // likely real cause of the memory blowout behind the iOS
            // WKWebView kills this whole investigation has been chasing.
            // error-callback/expired-callback below re-arm it for a genuine retry.
            needsExecuteRef.current = false
            recordEvent('turnstile:execute-called')
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
        recordEvent('turnstile:script-load-failed')
        // All retries exhausted (e.g. still offline). Widget silently fails
        // to appear; handleSubmit's missing-token check still blocks
        // submission, so this just shows as a stuck form rather than erroring.
      })

    return () => {
      recordEvent('turnstile:effect-cleanup')
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
