import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// End-to-end tests run the real backend and frontend on separate ports with a
// throwaway SQLite database, so they never touch your development data.
const API_PORT = 8001
const WEB_PORT = 5174
const db = join(tmpdir(), `vibestudio-e2e-${process.pid}.db`).replaceAll('\\', '/')
// Synthetic takes played into getUserMedia (see backend/scripts/make_hum_fixture.py).
// Chromium takes one fake-microphone file per browser launch, hence one project each.
const browserArgs = (micFile: string) => ({
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${resolve('e2e/fixtures', micFile)}%noloop`,
  ],
})

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // Uses an installed browser (no download). Override with PW_CHANNEL=chrome.
    channel: process.env.PW_CHANNEL ?? 'msedge',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'main',
      testIgnore: /beatbox\.spec/,
      use: { launchOptions: browserArgs('hum-twinkle.wav') },
    },
    {
      name: 'beatbox',
      testMatch: /beatbox\.spec/,
      use: { launchOptions: browserArgs('beatbox-boombap.wav') },
    },
  ],
  webServer: [
    {
      command: `node ../scripts/py.mjs -m alembic upgrade head && node ../scripts/py.mjs -m uvicorn app.main:app --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { VIBESTUDIO_DATABASE_URL: `sqlite:///${db}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VIBESTUDIO_BACKEND_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
