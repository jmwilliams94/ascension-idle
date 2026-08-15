import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

export default defineConfig({
  // Custom domain (ascensionidle.com) serves at the domain root, not a
  // /ascension-idle/ subpath — was '/ascension-idle/' back when this only
  // lived at jmwilliams94.github.io/ascension-idle/. Do not flip back
  // without also removing public/CNAME.
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Installable + fast static-asset reloads only — no Supabase/API caching,
      // no offline gameplay. See CLAUDE.md's "PWA & Mobile" section.
      // 'prompt' (was 'autoUpdate') — a new build now surfaces an "update
      // available" banner (UpdateBanner.tsx) with a Refresh button instead of
      // silently taking over on the next natural reload.
      registerType: 'prompt',
      // lucky-icons/nav-icons (2026-08-16, reported by the user: visible
      // pop-in loading Lucky Lad/chest art) are small (~560KB combined) and
      // hit on every session (nav bar, Lucky tab), so they're precached
      // outright — Workbox content-hashes them, so they load instantly from
      // Cache Storage indefinitely and self-invalidate on the next build if
      // the art actually changes (no more manual `?v=` cache-busting needed
      // for precached paths, though navIcons.ts's iconUrl() still appends it
      // as a fallback for the pre-SW/first-load window — see
      // ignoreURLParametersMatching below for why that doesn't break the
      // precache match). item-icons/ is NOT included here — 23MB across
      // 140+ files, far too large to bundle into every SW install; see the
      // runtimeCaching CacheFirst route below instead.
      includeAssets: ['favicon.svg', 'lucky-icons/**/*.png', 'nav-icons/**/*.png'],
      workbox: {
        // Precached URLs have no `?v=` query string, but navIcons.ts's
        // iconUrl() requests nav-icons/lucky-icons with one anyway (see
        // above) — without this, Workbox's precache route wouldn't match
        // those requests and would fall through to network on every load.
        ignoreURLParametersMatching: [/^v$/],
        runtimeCaching: [
          {
            // item-icons/ (gear/material art) is viewed piecemeal — cache
            // each icon the first time it's actually seen rather than
            // precaching all 23MB upfront. CacheFirst: once cached, never
            // re-fetched until it falls out of the 90-day/300-entry window,
            // since this art only ever changes via a deliberate in-place
            // swap (rare) rather than routine builds.
            urlPattern: ({ url }) => url.pathname.includes('/item-icons/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'item-icons',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Ascension Idle',
        short_name: 'Ascension Idle',
        description: 'A Melvor-idle-style idle RPG.',
        // Matches the new "A" logo's own background exactly (sampled from
        // the source image, 2026-08-02) — was #150821 (dark purple, matching
        // the old lightning-bolt favicon.svg mark), now #0b0f19 (near-black
        // navy) so the splash screen/browser chrome tint doesn't clash with
        // the new icon's own background showing through on maskable/adaptive
        // icon shapes.
        theme_color: '#0b0f19',
        background_color: '#0b0f19',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-icons/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  define: {
    // Single source of truth is package.json's "version" — see src/version.ts.
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
})
