import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Vite configuration for DineIQ Analytics.
 *
 * - Serves on 0.0.0.0:3000 (strict port) so the sandbox gateway proxies
 *   the preview to this dev server.
 * - `@` alias points to ./src to keep imports stable across the app.
 * - SPA fallback is enabled by default (appType: 'spa'), so client-side
 *   routes such as /dashboard resolve to index.html.
 */
export default defineConfig(({ mode }) => {
  // Keep browser requests on the frontend origin so Flask session cookies work.
  // This server-only setting also supports an existing backend on another port.
  const env = loadEnv(mode, process.cwd(), 'DINEIQ_')
  const backendUrl = process.env.DINEIQ_BACKEND_URL || env.DINEIQ_BACKEND_URL || 'http://127.0.0.1:5000'
  const proxy = { '/api': { target: backendUrl, changeOrigin: true } }
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      allowedHosts: true,
      proxy,
    },
    preview: {
      port: 3000,
      strictPort: true,
      proxy,
    },
    optimizeDeps: {
      // Restrict dependency scanning to the app entry — the sandbox contains
      // unrelated template HTML (skills/, examples/) that must not be scanned.
      entries: ['index.html'],
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          // Split heavy visualization vendors so they load in parallel and cache
          // independently of app code (spec §46).
          manualChunks: {
            'vendor-echarts': ['echarts'],
            'vendor-recharts': ['recharts'],
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
  }
})
