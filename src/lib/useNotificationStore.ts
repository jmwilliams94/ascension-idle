import { create } from 'zustand'
import { supabase } from './supabaseClient'

// Push notification groundwork (2026-08-28) — see CLAUDE.pwa-and-mobile.md's
// Push Notifications section for the full pipeline (src/sw.ts's `push`
// listener, the push_subscriptions table, send-push Edge Function). No real
// game event fires a push yet; this store only backs the Settings >
// Notifications toggle + "Send test notification" button.
//
// permission/subscribed are never persisted client-side — they're re-synced
// from the real browser/SW state on every mount (mirrors useAppUpdateStore's
// "server/browser is the source of truth" convention) so this can't drift
// from what the browser actually thinks across reloads or after the player
// revokes permission from browser chrome instead of the in-app toggle.
interface NotificationState {
  permission: NotificationPermission
  subscribed: boolean
  busy: boolean
  supported: boolean
  isStandalone: boolean
  refresh: () => Promise<void>
  enable: (accountId: string) => Promise<{ ok: boolean; error?: string; detail?: string }>
  disable: (accountId: string) => Promise<{ ok: boolean; error?: string; detail?: string }>
}

function detectStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true
  }
  // iOS Safari has no display-mode media query support pre-installation;
  // navigator.standalone is its own long-standing non-standard signal for
  // "running from the Home Screen" instead.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

// PushSubscriptionOptionsInit.applicationServerKey wants a BufferSource
// backed by a real ArrayBuffer, not the wider ArrayBufferLike (which also
// covers SharedArrayBuffer) Uint8Array.from()'s return type carries — the
// bytes underneath are always a plain ArrayBuffer here, just not provably so
// to the type checker.
function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0))) as Uint8Array<ArrayBuffer>
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  subscribed: false,
  busy: false,
  supported: typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window,
  isStandalone: typeof window !== 'undefined' && detectStandalone(),

  refresh: async () => {
    if (!get().supported) {
      return
    }
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    set({ permission: Notification.permission, subscribed: subscription !== null })
  },

  enable: async (accountId) => {
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!get().supported || !vapidPublicKey) {
      return { ok: false, error: 'unsupported' }
    }

    set({ busy: true })
    try {
      const permission = await Notification.requestPermission()
      set({ permission })
      if (permission !== 'granted') {
        return { ok: false, error: 'permission_denied' }
      }

      const registration = await navigator.serviceWorker.ready
      // Re-subscribing with a *different* applicationServerKey than an
      // already-live subscription throws InvalidStateError on some browsers
      // -- reuse the existing one rather than assuming subscribe() is
      // always safe to call again.
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
        }))
      const json = subscription.toJSON()
      const keys = json.keys as { p256dh?: string; auth?: string } | undefined
      if (!json.endpoint || !keys?.p256dh || !keys.auth) {
        return { ok: false, error: 'subscribe_failed' }
      }

      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          account_id: accountId,
          endpoint: json.endpoint,
          p256dh_key: keys.p256dh,
          auth_key: keys.auth,
          user_agent: navigator.userAgent,
        },
        { onConflict: 'endpoint' },
      )
      if (error) {
        console.error('push_subscriptions upsert failed', error)
        return { ok: false, error: 'save_failed' }
      }

      set({ subscribed: true })
      return { ok: true }
    } catch (err) {
      // Was previously an uncaught rejection (try/finally with no catch) --
      // pushManager.subscribe() throwing (a real DOMException on some
      // browsers, e.g. a stale/mismatched applicationServerKey from an
      // already-subscribed-with-a-different-key state) surfaced as
      // literally nothing: no toggle change, no error, only a console
      // warning nobody would see (reported by the user, 2026-08-28).
      console.error('push enable() failed', err)
      return { ok: false, error: 'exception', detail: err instanceof Error ? err.message : String(err) }
    } finally {
      set({ busy: false })
    }
  },

  disable: async (accountId) => {
    if (!get().supported) {
      return { ok: false, error: 'unsupported' }
    }

    set({ busy: true })
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        await supabase.from('push_subscriptions').delete().eq('account_id', accountId).eq('endpoint', endpoint)
      }
      set({ subscribed: false })
      return { ok: true }
    } catch (err) {
      console.error('push disable() failed', err)
      return { ok: false, error: 'exception', detail: err instanceof Error ? err.message : String(err) }
    } finally {
      set({ busy: false })
    }
  },
}))
