// A20 throwaway config — run the sanctioned axe sweep at a phone viewport
// WITHOUT editing the product playwright.config.ts (whose mobile projects carry
// a testMatch allowlist that excludes the a11y spec). Report-only; delete with
// the spec. Reuses the already-running dev servers and the storageState files
// minted earlier today by global-setup (valid 24h), so no globalSetup needed.
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

export default defineConfig({
  testDir: path.resolve(process.cwd(), 'e2e/specs/a11y'),
  timeout: 75_000,
  expect: { timeout: 25_000 },
  fullyParallel: true,
  workers: undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 20_000,
    navigationTimeout: 25_000,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['iPhone SE'],
        defaultBrowserType: 'chromium',
        viewport: { width: 375, height: 667 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev:all',
    url: 'http://localhost:5173',
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
