import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/e2e',
  testMatch: 'client-portal-dashboard-loading.spec.js',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL: 'http://127.0.0.1:5178', reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1365, height: 768 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run build:web && npm --prefix portal-client run preview -- --host 127.0.0.1 --port 5178 --strictPort',
    url: 'http://127.0.0.1:5178',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...process.env, VITE_SUPABASE_URL: 'https://portal-e2e.supabase.co', VITE_SUPABASE_ANON_KEY: 'portal-e2e-anon-key' },
  },
});
