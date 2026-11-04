import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * The same handover, on Android, iPhone (WebKit, Safari's engine) and
 * desktop Chromium. Each browser gets its own server and empty
 * database, since the fake models always read the same container.
 */
const phones = [
  { name: 'android', device: devices['Pixel 7'], port: 4011 },
  { name: 'iphone', device: devices['iPhone 15 Pro'], port: 4012 },
  { name: 'desktop', device: devices['Desktop Chrome'], port: 4013 },
] as const;

const samplesDir = mkdtempSync(join(tmpdir(), 'plomba-e2e-samples-'));
const credit = 'Synthetic test fixture, Plomba authors, Apache-2.0';
const samples = [
  { file: 'side.mp4', title: 'Synthetic sample clip', credit, containerNumber: 'PLBU1234562' },
  { file: 'unlinked.mp4', title: 'Unlinked synthetic clip', credit },
  { file: 'doors.jpg', title: 'Synthetic door photo CSQU3054383', credit, use: 'doors' },
  ...['D', 'R', 'F', 'L', 'T'].map((use) => ({
    file: `${use}.jpg`,
    title: `Synthetic face ${use}`,
    credit,
    use,
  })),
];
for (const sample of samples) {
  copyFileSync(
    join(
      import.meta.dirname,
      'e2e/fixtures',
      sample.file.endsWith('.mp4') ? 'container-side.mp4' : 'container-side.jpg',
    ),
    join(samplesDir, sample.file),
  );
}
writeFileSync(join(samplesDir, 'samples.json'), JSON.stringify(samples));

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
        PLOMBA_SAMPLES_DIR: samplesDir,
        META_API_BASE_URL: 'http://127.0.0.1:4010/v1',
        META_API_KEY: 'e2e-test-key',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
    })),
  ],
});
