import { defineConfig } from '@playwright/test';
import { existsSync } from 'fs';

// Use system Chromium (e.g. Alpine package) when running in an Alpine/musl
// container where the Playwright-managed glibc-based headless shell cannot run.
function resolveChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  // Alpine Linux uses musl libc; the Playwright headless shell is glibc-based
  // and cannot run there. Fall back to the Alpine-packaged Chromium.
  const isAlpine = existsSync('/etc/alpine-release');
  if (isAlpine) {
    for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser']) {
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const chromiumExecutable = resolveChromiumExecutable();

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  timeout: 120000,
  expect: {
    timeout: 10000,
  },
  retries: 2,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://localhost:5173',
    // The dev server runs over HTTPS with a self-signed cert (VITE_HTTPS=true), so the
    // shared `page` fixture must accept it — otherwise every page.goto fails with
    // net::ERR_CERT_AUTHORITY_INVALID.
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    },
  ],
});
