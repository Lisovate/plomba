import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/** Each run starts from an empty database. */
const dataDir = mkdtempSync(join(tmpdir(), 'plomba-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4011',
    ...devices['Pixel 7'],
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/fake-meta-api.ts',
      url: 'http://127.0.0.1:4010/v1/responses',
      env: { FAKE_META_PORT: '4010' },
      reuseExistingServer: false,
    },
    {
      // Serves the built web app: run `npm run build` first.
      command: 'node apps/server/src/main.ts',
      url: 'http://127.0.0.1:4011/api/health',
      env: {
        PORT: '4011',
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
        WEB_DIST_DIR: 'apps/web/dist',
        META_API_BASE_URL: 'http://127.0.0.1:4010/v1',
        META_API_KEY: 'e2e-test-key',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
    },
  ],
});
