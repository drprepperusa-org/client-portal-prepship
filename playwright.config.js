import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './web/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  webServer: {
    // vite 8's CLI rejects flags forwarded through the double npm chain
    // (root dev:web -> portal-client dev) as positional args, so the e2e
    // server gets its own single-layer script with the flags baked in.
    command: 'npm --prefix portal-client run dev:e2e',
    env: {
      ...process.env,
      // Deterministic, non-production Supabase identity for authenticated E2E.
      // Tests install a future-expiry local session and intercept every portal API.
      VITE_SUPABASE_URL: 'https://portal-e2e.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'portal-e2e-anon-key',
    },
    url: 'http://127.0.0.1:5177',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
