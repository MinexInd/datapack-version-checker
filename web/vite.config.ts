import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // The sandbox browser cannot reach api.spyglassmc.com directly (the 15s
      // fetcher timeout fires) even though Node can. Proxy the Spyglass API
      // through Vite so requests run server-side. A no-op in production (GH
      // Pages builds the static dist; the browser hits the real, CORS-enabled
      // endpoint directly via the fallback in browser-externals.ts).
      '/api/spyglassmc': {
        target: 'https://api.spyglassmc.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/spyglassmc/, ''),
      },
    },
  },
})
