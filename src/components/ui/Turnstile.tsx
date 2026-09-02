import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { recordEvent } from '../../lib/debugTrail'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => boolean | void
  theme?: 'light' | 'dark' | 'auto'
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
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

  useEffect(() => {
    onVerifyRef.current = onVerify
    onExpireRef.current = onExpire
  }, [onVerify, onExpire])

  useImperativeHandle(ref, () => ({
    reset: () => {
      // Default execution:'render' mode (see the effect below) re-verifies
      // automatically as soon as reset() runs -- no manual re-trigger needed.
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
    },
  }))

  useEffect(() => {
    if (!SITE_KEY) return

    let cancelled = false

    recordEvent('turnstile:script-load-start')

    loadTurnstileScriptWithRetry(() => cancelled)
      .then(() => {
        recordEvent('turnstile:script-loaded', `cancelled=${cancelled} hasContainer=${Boolean(containerRef.current)}`)
        if (cancelled || !containerRef.current || !window.turnstile) return
        // Plain default execution:'render' (2026-09-02, was execution:'execute'
        // deferred to the page's first pointerdown/keydown) -- that gesture-
        // deferred pattern was written to work around an older Safari ITP
        // quirk, but turned out to be the trigger for a confirmed, currently
        // open Cloudflare/WebKit bug: calling execute() from inside a fresh
        // touch handler kills and reloads the whole page on iOS (see
        // community.cloudflare.com/t/turnstile-kills-and-reloads-the-page-on-
        // first-challenge-of-a-session-on-ios-26-5-w/940075). Confirmed via
        // this app's own debug trail (2026-09-02): every reload traced back
        // to a touch immediately followed by an execute() call. Verifying
        // automatically on mount instead removes that trigger entirely.
        // Tradeoff accepted (user's explicit call): under Safari's "Prevent
        // Cross-Site Tracking" this can occasionally render blank with no
        // token instead of crashing -- a stuck form, not a crash loop.
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => {
            recordEvent('turnstile:verified', `tokenLen=${token.length}`)
            onVerifyRef.current(token)
          },
          'expired-callback': () => {
            recordEvent('turnstile:expired')
            onExpireRef.current?.()
          },
          'error-callback': () => {
            recordEvent('turnstile:error-callback')
            onExpireRef.current?.()
            return true
          },
          theme: 'dark',
        })
        recordEvent('turnstile:rendered', `widgetId=${widgetIdRef.current}`)
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
