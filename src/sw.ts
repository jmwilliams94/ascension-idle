/// <reference lib="webworker" />

// Custom service worker source (switched from vite-plugin-pwa's default
// generateSW to injectManifest, 2026-08-28) -- generateSW can't add a `push`
// event listener, and Web Push notifications need one. See
// CLAUDE.pwa-and-mobile.md's Push Notifications section.
//
// registerType stays 'prompt' (vite.config.ts) -- an update install must NOT
// auto-activate, or UpdateBanner.tsx's whole "Refresh" flow breaks (a
// waiting worker that immediately claims control defeats the deliberate
// prompt). generateSW's own template always includes the SKIP_WAITING
// message listener below regardless of its skipWaiting build option; nothing
// is auto-injected in injectManifest mode, so it's written out explicitly
// here instead. No self.skipWaiting()/clientsClaim() call on
// install/activate -- same "stay waiting until the player clicks Refresh"
// behavior as before this switch.
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

// Precached URLs have no `?v=` query string, but navIcons.ts's iconUrl()
// requests nav-icons/lucky-icons with one anyway (a fallback for the pre-SW/
// first-load window) — without this, the precache route wouldn't match
// those requests and would fall through to network on every load.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/^v$/] })

// Literal port of vite.config.ts's former workbox.runtimeCaching entry --
// item-icons/ (gear/material art, 23MB across 140+ files) is cached
// piecemeal on first view rather than precached upfront.
registerRoute(
  ({ url }) => url.pathname.includes('/item-icons/'),
  new CacheFirst({
    cacheName: 'item-icons',
    plugins: [
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    payload = { body: event.data?.text() }
  }

  const title = payload.title ?? 'Ascension Idle'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/pwa-icons/pwa-192.png',
      badge: '/pwa-icons/pwa-192.png',
      data: { url: payload.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data?.url as string | undefined) ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
