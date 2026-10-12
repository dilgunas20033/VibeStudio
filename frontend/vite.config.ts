/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Read server-only settings here; only VITE_* variables ever reach the browser bundle.
  const env = loadEnv(mode, '..', 'VIBESTUDIO_')
  const backend = env.VIBESTUDIO_BACKEND_URL ?? 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss()],
    envDir: '..',
    server: {
      port: 5173,
      strictPort: true,
      // The browser calls same-origin /api; Vite forwards it to FastAPI in development.
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
