import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

export default defineConfig({
  base: '/greybox-idle/',
  plugins: [react(), tailwindcss()],
  define: {
    // Single source of truth is package.json's "version" — see src/version.ts.
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
})
