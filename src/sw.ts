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
import { StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

// Precached URLs have no `?v=` query string, but navIcons.ts's iconUrl()
// requests nav-icons/lucky-icons with one anyway (a fallback for the pre-SW/
// first-load window) — without this, the precache route wouldn't match
// those requests and would fall through to network on every load.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/^v$/] })

// item-icons/ (gear/material art, growing past 300 files as of 2026-08-28)
// is cached piecemeal on first view rather than precached upfront. StaleWhileRevalidate
// (2026-08-28, was CacheFirst since this route's original vite.config.ts
// workbox.runtimeCaching days) -- item-icon URLs are plain unversioned paths
// (no `?v=` cache-bust like navIcons.ts's iconUrl() uses for nav/lucky
// icons), so under CacheFirst a phone that had already cached an icon PNG
// would keep serving those exact bytes for up to maxAgeSeconds below no
// matter how many app updates shipped a fixed version of that same file --
// bit the Bracelet/Bag icon crop fixes (v1.111.5/1.111.7) this way, reported
// by the user weeks later still seeing the old art on mobile only (desktop's
// browser cache is far more likely to have already been cleared/expired
// naturally). StaleWhileRevalidate still serves instantly from cache (same
// perceived speed/offline behavior as before) but also fires a background
// fetch to refresh that cache entry, so a fixed icon self-heals within one
// extra load instead of staying wrong for up to 90 days.
//
// cacheName bumped to 'item-icons-v2' (one-time, this fix only -- not tied
// to APP_VERSION, which would force a full ~23MB re-download on every
// future deploy) so every phone still holding pre-fix cropped icons under
// the old 'item-icons' cache starts clean instead of waiting on
// StaleWhileRevalidate's background-refresh-on-next-request to eventually
// catch up. The abandoned 'item-icons' cache is left for the browser's own
// storage-pressure eviction rather than explicitly deleted -- not worth the
// added complexity for a bounded, capped-entries cache.
// maxEntries bumped 300 -> 600 (2026-08-28, reported by the user as icons
// visibly "popping in all at once" switching between Equipment/Bank/
// Inventory) -- public/item-icons/ had already grown past 300 files (317 at
// the time of this fix), so the cache was constantly at its cap and
// ExpirationPlugin was evicting older entries on every new icon fetch. A
// character with a reasonable equipment/inventory/bank spread easily
// references more than 300 distinct icons in one session, so entries kept
// getting evicted and re-fetched over the network right as a heavy grid
// (Equipment's paper doll, Bank's full inventory) mounted -- StaleWhileRevalidate
// still serves a cache hit instantly, but an eviction forces a real fetch,
// and several of those landing around the same tick reads as "everything
// rendering at once." 600 gives headroom well past the current file count
// for future icon additions without needing another bump soon.
registerRoute(
  ({ url }) => url.pathname.includes('/item-icons/'),
  new StaleWhileRevalidate({
    cacheName: 'item-icons-v2',
    plugins: [
      new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 90 }),
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

  // Not 'Ascension Idle' -- the OS/browser already shows that as this
  // notification's own "from Ascension Idle" attribution (from the manifest
  // name), so reusing it as the title reads as a duplicated "Ascension Idle
  // from Ascension Idle" if a real caller ever omits its own title.
  const title = payload.title ?? 'Notification'
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
