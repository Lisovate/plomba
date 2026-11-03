import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * The same handover, on an Android phone (Chromium) and on an iPhone
 * (WebKit, Safari's engine). Each phone gets its own server and empty
 * database, since the fake models always read the same container.
 */
const phones = [
  { name: 'android', device: devices['Pixel 7'], port: 4011 },
  { name: 'iphone', device: devices['iPhone 15 Pro'], port: 4012 },
] as const;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  projects: phones.map(({ name, device, port }) => ({
    name,
    use: { ...device, baseURL: `http://127.0.0.1:${port}` },
  })),
  webServer: [
    {
      command: 'node e2e/fake-meta-api.ts',
      url: 'http://127.0.0.1:4010/v1/responses',
      env: { FAKE_META_PORT: '4010' },
      reuseExistingServer: false,
    },
    ...phones.map(({ port }) => ({
      // Serves the built web app: run `npm run build` first.
      command: 'node apps/server/src/main.ts',
      url: `http://127.0.0.1:${port}/api/health`,
      env: {
        PORT: String(port),
        HOST: '127.0.0.1',
        DATA_DIR: mkdtempSync(join(tmpdir(), 'plomba-e2e-')),
        WEB_DIST_DIR: 'apps/web/dist',
        META_API_BASE_URL: 'http://127.0.0.1:4010/v1',
        META_API_KEY: 'e2e-test-key',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
    })),
  ],
});
