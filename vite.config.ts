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
      // injectManifest (was the default generateSW, 2026-08-28) — Web Push
      // notifications need a custom `push` event listener in the service
      // worker, which generateSW's fully auto-generated SW has no room for.
      // src/sw.ts is now the real SW source; the item-icons CacheFirst route
      // that used to live in the `workbox.runtimeCaching` option below moved
      // there verbatim. See CLAUDE.pwa-and-mobile.md's Push Notifications
      // section and tsconfig.sw.json (sw.ts typechecks separately, under the
      // "webworker" lib rather than DOM).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // lucky-icons/nav-icons (2026-08-16, reported by the user: visible
      // pop-in loading Lucky Lad/chest art) are small (~560KB combined) and
      // hit on every session (nav bar, Lucky tab), so they're precached
      // outright — Workbox content-hashes them, so they load instantly from
      // Cache Storage indefinitely and self-invalidate on the next build if
      // the art actually changes (no more manual `?v=` cache-busting needed
      // for precached paths, though navIcons.ts's iconUrl() still appends it
      // as a fallback for the pre-SW/first-load window — see sw.ts's
      // ignoreURLParametersMatching option for why that doesn't break the
      // precache match). item-icons/ is NOT included here — 23MB across
      // 140+ files, far too large to bundle into every SW install; see
      // sw.ts's CacheFirst route instead.
      includeAssets: ['favicon.svg', 'lucky-icons/**/*.png', 'nav-icons/**/*.png'],
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
