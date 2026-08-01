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
  base: '/ascension-idle/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Installable + fast static-asset reloads only — no Supabase/API caching,
      // no offline gameplay. See CLAUDE.md's "PWA & Mobile" section.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
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
        start_url: '/ascension-idle/',
        scope: '/ascension-idle/',
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
