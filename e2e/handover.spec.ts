import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const photo = join(import.meta.dirname, 'fixtures', 'container-side.jpg');

test('a checker identifies a container, records damage, seals the handover and sends CODECO', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: "Who's checking?" }).click();
  await page.getByLabel('Your name').fill('Paweł Lisowski');
  await page.getByLabel('Place (terminal or depot)').fill('Gdynia rail terminal');
  await page.getByRole('link', { name: 'Inspect a container' }).click();

  // Identify: the fake Muse Spark reads a valid number, so it's verified and filled in.
  await page.locator('input[type=file]:not([capture])').setInputFiles(photo);
  await expect(page.getByRole('heading', { name: 'Check digit verified' })).toBeVisible();
  await expect(page.getByLabel('Container number')).toHaveValue('CSQU3054383');
  await expect(page.getByText('Seals: PL123456')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm container' }).click();

  // Start the handover; the seal read from the doors is carried over.
  await expect(page.getByLabel('Checker', { exact: true })).toHaveValue('Paweł Lisowski');
  await expect(page.getByLabel('Place', { exact: true })).toHaveValue('Gdynia rail terminal');
  await expect(page.getByLabel('Seal numbers, comma-separated')).toHaveValue('PL123456');
  // It came by rail: the wagon number is checked with the UIC check digit as it's typed.
  await page.getByRole('radio', { name: 'Rail wagon' }).check({ force: true });
  await page.getByLabel('Wagon number (UIC, 12 digits)').fill('21 81 2471 217-4');
  await expect(page.getByText('The check digit should be 3')).toBeVisible();
  await page.getByLabel('Wagon number (UIC, 12 digits)').fill('21 81 2471 217-3');
  await expect(page.getByText('21 81 2471 217-3 · valid UIC number')).toBeVisible();
  await page.getByRole('button', { name: 'Start handover' }).click();
  await expect(page.getByText('Wagon 21 81 2471 217-3')).toBeVisible();

  // Photograph the right side: SAM's recorded outline registers the face.
  await page.getByRole('button', { name: 'Right' }).click();
  await page.locator('input[type=file]:not([capture])').setInputFiles(photo);
  await expect(page.locator('.overlay-frame')).toBeVisible();
  await expect(page.locator('polygon.grid-cell.covered')).toHaveCount(10);
  await expect(page.getByText('Sections with a photo: 10 of 46')).toBeVisible();

  // Draw a dent near the door end, low on the side: section 1, bottom half.
  await page.getByRole('button', { name: 'Mark damage' }).click();
  const overlay = await page.locator('svg.overlay').boundingBox();
  if (!overlay) throw new Error('No overlay');
  await page.mouse.move(overlay.x + overlay.width * 0.12, overlay.y + overlay.height * 0.68);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.18, overlay.y + overlay.height * 0.76, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.locator('form.card h3')).toHaveText('RB1N');
  await page.getByRole('button', { name: /DT Dent/ }).click();
  await page.getByRole('button', { name: 'Save mark' }).click();
  await expect(page.locator('.list-item', { hasText: 'RB1N' })).toBeVisible();

  // Seal, accepting the faces that weren't photographed.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Not photographed: Doors (8 sections)');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Seal handover' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sealed into the container history' }),
  ).toBeVisible();

  // The EIR, and the CODECO message with the damage and the record hash.
  await page.getByRole('link', { name: 'Open the EIR' }).click();
  await expect(
    page.getByRole('heading', { name: 'Equipment interchange receipt (EIR)' }),
  ).toBeVisible();
  const href = await page.getByRole('link', { name: 'Download CODECO' }).getAttribute('href');
  const codeco = await (await page.request.get(href ?? '')).text();
  expect(codeco).toContain("BGM+34+CSQU3054383-1+9'");
  expect(codeco).toContain("DAM+1+DT+RB1N'");
  expect(codeco).toContain("SEL+PL123456'");
  expect(codeco).toContain("TDT+1+218124712173+2'");

  // The container's history verifies.
  await page.goto('/containers/CSQU3054383');
  await expect(page.getByText('History intact · sealed handovers: 1')).toBeVisible();
});

test('a checker keeps a walk-around, replays tracked and untracked evidence, and prints its hashes', async ({
  page,
}) => {
  const number = 'PLBU4000043';
  await page.request.post('/api/containers', { data: { number, sizeTypeCode: '22G1' } });
  const started = await page.request.post('/api/handovers', {
    data: {
      containerNumber: number,
      direction: 'in',
      place: 'Gdynia',
      checker: 'PL',
    },
  });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  await page.goto(`/handovers/${id}/walkaround`);
  const clipPath = join(import.meta.dirname, 'fixtures', 'container-side.mp4');
  await page.locator('input[type=file]').setInputFiles(clipPath);
  await page.getByRole('button', { name: 'Analyse the walk-around' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Keep the video with the handover' }),
  ).toBeChecked();
  let release = () => {};
  const uploading = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/handovers/${id}/videos`, async (route) => {
    await uploading;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Add to the handover (photos: 1)' }).click();
  try {
    await expect(
      page.getByText('SAM 3.1 · blurring people and number plates in the walk-around video…'),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(page).toHaveURL(new RegExp(`/handovers/${id}$`));
  const card = page.locator('.walkaround-evidence');
  await expect(card).toHaveCount(1);
  await expect(card.locator('polygon.grid-cell')).toHaveCount(10);
  const detail = (await (await page.request.get(`/api/handovers/${id}`)).json()) as {
    videos: {
      id: string;
      url: string;
      sha256: string;
      views: { frame: number; view: { face: string } }[];
    }[];
  };
  const tracked = detail.videos[0];
  if (!tracked) throw new Error('No saved clip');
  expect(tracked.views).toEqual([
    expect.objectContaining({ view: expect.objectContaining({ face: 'R' }) }),
  ]);
  await expect(card.getByText(tracked.sha256)).toBeVisible();

  // A visibly different clip has no cached tracking; trailing bytes disappear on redaction.
  const { stdout: untrackedClip } = await promisify(execFile)(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      clipPath,
      '-vf',
      'hflip',
      '-c:v',
      'libx264',
      '-threads',
      '2',
      '-an',
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
  );
  const untracked = await page.request.post(`/api/handovers/${id}/videos`, {
    multipart: {
      video: {
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        buffer: untrackedClip,
      },
    },
  });
  expect(untracked.status()).toBe(201);
  const plain = (await untracked.json()) as { id: string; url: string; sha256: string };
  const missing = await page.request.get(`/api/handovers/${id}/videos/${plain.id}/tracking`);
  expect(missing.status()).toBe(404);
  await page.reload();
  await expect(card).toHaveCount(2);
  await expect(card.nth(1).locator('svg.overlay')).toHaveCount(0);
  const players = card.locator('video');
  for (const player of await players.all()) {
    await player.scrollIntoViewIfNeeded();
    await expect
      .poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    await player.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
    });
    await expect
      .poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0);
    await player.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = 1;
    });
    await expect
      .poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeCloseTo(1, 1);
  }
  const range = await page.request.get(tracked.url, { headers: { range: 'bytes=0-3' } });
  expect(range.status()).toBe(206);
  expect(range.headers()['content-range']).toMatch(/^bytes 0-3\//);

  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Seal handover' }).click();
  await page.getByRole('link', { name: 'Open the EIR' }).click();
  await expect(page.getByText(tracked.sha256)).toBeVisible();
  await expect(page.getByText(plain.sha256)).toBeVisible();
  const history = (await (await page.request.get(`/api/containers/${number}`)).json()) as {
    chain: { ok: boolean };
  };
  expect(history.chain.ok).toBe(true);
});

test('a checker can add walk-around photos when video evidence is unavailable', async ({
  page,
}) => {
  await page.route('**/api/instance', (route) =>
    route.fulfill({
      json: { notice: null, videoEvidence: false },
    }),
  );
  const number = 'PLBU4000059';
  await page.request.post('/api/containers', { data: { number, sizeTypeCode: '22G1' } });
  const started = await page.request.post('/api/handovers', {
    data: { containerNumber: number, direction: 'in', place: 'Gdynia', checker: 'PL' },
  });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  let videoUploads = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/handovers/${id}/videos`))
      videoUploads++;
  });
  await page.goto(`/handovers/${id}/walkaround`);
  await page
    .locator('input[type=file]')
    .setInputFiles(join(import.meta.dirname, 'fixtures', 'container-side.mp4'));
  await page.getByRole('button', { name: 'Analyse the walk-around' }).click();
  const add = page.getByRole('button', { name: 'Add to the handover (photos: 1)' });
  await expect(add).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Keep the video with the handover' }),
  ).toHaveCount(0);
  await add.click();
  await expect(page).toHaveURL(new RegExp(`/handovers/${id}$`));
  const detail = await (await page.request.get(`/api/handovers/${id}`)).json();
  expect(detail.photos).toHaveLength(1);
  expect(detail.videos).toEqual([]);
  expect(videoUploads).toBe(0);
});
