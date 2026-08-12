import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Some environments ship a pre-installed Chromium whose revision does not match
 * the one this @playwright/test version would download. When such a binary is
 * present we point at it explicitly; otherwise Playwright uses its own managed
 * browser (`npx playwright install`), which is what CI and most contributors get.
 *
 * Override with PLAYWRIGHT_CHROMIUM_PATH.
 */
function resolveChromium(): string | undefined {
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return candidates.find((p) => fs.existsSync(p));
}

const chromiumPath = resolveChromium();

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    locale: 'he-IL',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath === undefined ? {} : { launchOptions: { executablePath: chromiumPath } }),
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        ...(chromiumPath === undefined ? {} : { launchOptions: { executablePath: chromiumPath } }),
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
