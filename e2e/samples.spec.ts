import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ContainerHistorySchema, HandoverSchema, MarkSchema } from '@plomba/contracts';

const NUMBER = 'PLBU1234562';

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(`/api${path}`, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function passport(request: APIRequestContext) {
  await post(request, '/containers', { number: NUMBER, sizeTypeCode: '42G1' });
  const first = HandoverSchema.parse(
    await post(request, '/handovers', {
      containerNumber: NUMBER,
      direction: 'in',
      place: 'Gdynia',
      checker: 'Sample checker',
    }),
  );
  const dent = MarkSchema.parse(
    await post(request, `/handovers/${first.id}/marks`, {
      face: 'R',
      rect: { u0: 2, v0: 0.3, u1: 3, v1: 0.7 },
      damageCode: 'DT',
    }),
  );
  const hole = MarkSchema.parse(
    await post(request, `/handovers/${first.id}/marks`, {
      face: 'R',
      rect: { u0: 6, v0: 0.3, u1: 7, v1: 0.7 },
      damageCode: 'HO',
    }),
  );
  await post(request, `/handovers/${first.id}/close`, { acceptGaps: true });
  const last = HandoverSchema.parse(
    await post(request, '/handovers', {
      containerNumber: NUMBER,
      direction: 'out',
      place: 'Łódź',
      checker: 'Sample checker',
    }),
  );
  await post(request, `/handovers/${last.id}/marks`, {
    face: dent.face,
    rect: dent.rect,
    damageCode: dent.damageCode,
    previousMarkId: dent.id,
    status: 'still-there',
  });
  await post(request, `/handovers/${last.id}/marks`, {
    face: hole.face,
    rect: hole.rect,
    damageCode: hole.damageCode,
    previousMarkId: hole.id,
    status: 'repaired',
  });
  await post(request, `/handovers/${last.id}/marks`, {
    face: 'L',
    rect: { u0: 2, v0: 0.3, u1: 3, v1: 0.7 },
    damageCode: 'CO',
  });
  await post(request, `/handovers/${last.id}/close`, { acceptGaps: true });
  return ContainerHistorySchema.parse(
    await (await request.get(`/api/containers/${NUMBER}`)).json(),
  );
}

async function still(page: Page, time: number) {
  await page.locator('.video-ar video').scrollIntoViewIfNeeded();
  await page.locator('.video-ar video').evaluate((element, currentTime) => {
    const video = element as HTMLVideoElement;
    video.pause();
    video.currentTime = currentTime;
  }, time);
}

test('sample AR shows the passport, follows the clip, switches layers and creates no handover', async ({
  page,
}, testInfo) => {
  const history = await passport(page.request);
  const before = await (await page.request.get('/api/handovers')).json();
  let releaseFaces = () => {};
  const facesReady = new Promise<void>((resolve) => {
    releaseFaces = resolve;
  });
  await page.route('**/api/videos/faces', async (route) => {
    await facesReady;
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'No container nearby? See it on sample footage' }).click();
  await expect(page.getByRole('heading', { name: 'See what the checker sees' })).toBeVisible();
  await page.getByRole('button', { name: /^Synthetic sample clip/ }).click();
  try {
    await expect(page.locator('.face-outline')).toHaveCount(1);
    await expect(page.locator('.guide-grid')).toHaveCount(20);
    await expect(page.locator('.video-info')).toContainText('PLBU 123456 2');
    await expect(page.locator('.video-face-name')).toHaveCount(0);
    await expect(page.locator('.passport-ghost')).toHaveCount(0);
    await expect(page.locator('.video-ar [role="status"]')).toHaveText(
      'Muse Spark is naming each face…',
    );
    await expect(page.locator('.sample-player .spinner')).toHaveCount(0);
    await expect(page.locator('.video-ar video')).toHaveJSProperty('paused', false);
    await page.getByRole('button', { name: 'Język: polski' }).click();
    await expect(page.locator('.video-ar [role="status"]')).toHaveText(
      'Muse Spark rozpoznaje każdą ścianę…',
    );
    await page.getByRole('button', { name: 'Language: English' }).click();
    await page
      .locator('.sample-player')
      .screenshot({ path: testInfo.outputPath('sample-tracking.png') });
  } finally {
    releaseFaces();
  }
  await expect(page.locator('.passport-ghost')).toHaveCount(1);
  await expect(page.locator('.guide-grid')).toHaveCount(0);
  await expect(page.locator('.video-ar [role="status"]')).toHaveCount(0);
  await still(page, 0.2);
  await expect(page.locator('.video-info')).toContainText('PLBU 123456 2');
  await expect(page.locator('.video-info')).toContainText('42G1 · 40 ft general purpose');
  await expect(page.locator('.video-info')).toContainText('Last: Łódź · Gate out');
  await expect(page.locator('.video-info')).toContainText('Sealed records verified: 2');
  await expect(page.locator('.passport-ghost')).toContainText('First: Gdynia');
  await expect(page.locator('.passport-ghost')).toContainText('DT');
  await expect(page.locator('.passport-ghost')).not.toContainText('HO');
  await expect(page.locator('.video-face-name')).toHaveText('Right');
  await expect(page.locator('.grid-cell')).toHaveCount(20);
  await expect(page.locator('.sample-caption')).toContainText('Synthetic test fixture');

  const outline = page.locator('.face-outline');
  const firstOutline = await outline.getAttribute('points');
  const firstTagLeft = await page
    .locator('.video-info')
    .evaluate((element) => getComputedStyle(element).left);
  await still(page, 1.2);
  await expect(outline).not.toHaveAttribute('points', firstOutline ?? '');
  await expect(page.locator('.video-info')).not.toHaveCSS('left', firstTagLeft);
  const tag = await page.locator('.video-info').boundingBox();
  const player = await page.locator('.video-ar').boundingBox();
  expect(
    tag && player && tag.x >= player.x && tag.x + tag.width <= player.x + player.width + 1,
  ).toBeTruthy();
  const face = await outline.boundingBox();
  expect(tag && face && tag.y + tag.height < face.y).toBeTruthy();
  const picture = await page.locator('.video-ar video').boundingBox();
  const overlay = await page.locator('.video-ar svg.overlay').boundingBox();
  expect(
    picture &&
      overlay &&
      Math.abs(picture.y - overlay.y) < 1 &&
      Math.abs(picture.height - overlay.height) < 1,
  ).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.sample-player')
    .screenshot({ path: testInfo.outputPath('sample-ar-en.png') });

  await page.getByRole('checkbox', { name: 'Outline, faces and grid' }).uncheck();
  await expect(page.locator('.grid-cell')).toHaveCount(0);
  await expect(page.locator('.face-outline')).toHaveCount(0);
  await expect(page.locator('.passport-ghost')).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Open damage', exact: true }).uncheck();
  await expect(page.locator('.passport-ghost')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Container information' }).uncheck();
  await expect(page.locator('.video-info')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Container information' }).check();
  await page.getByRole('checkbox', { name: 'Open damage', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Outline, faces and grid' }).check();
  await page.getByRole('button', { name: 'Język: polski' }).click();
  await expect(page.locator('.video-info')).toContainText('Zaplombowane zapisy zweryfikowane: 2');
  await expect(page.locator('.passport-ghost')).toContainText('Pierwszy zapis: Gdynia');
  await page
    .locator('.sample-player')
    .screenshot({ path: testInfo.outputPath('sample-ar-pl.png') });
  expect(await (await page.request.get('/api/handovers')).json()).toEqual(before);
  expect(history.damage.filter((d) => d.status !== 'repaired')).toHaveLength(2);
});

test('an unlinked clip still shows faces and the grid without inventing a passport', async ({
  page,
}) => {
  await page.goto('/try');
  await page.getByRole('button', { name: /^Unlinked synthetic clip/ }).click();
  await expect(page.locator('.grid-cell')).toHaveCount(20);
  await expect(page.locator('.video-info')).toHaveCount(0);
  await expect(page.locator('.passport-ghost')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Open damage', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Container information' })).toBeDisabled();
  await expect(page.getByText('This clip has no linked container.')).toBeVisible();
});

test('a face naming failure keeps the outline and retries without tracking again', async ({
  page,
}) => {
  let tracks = 0;
  let names = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/videos/track')) tracks++;
  });
  await page.route('**/api/videos/faces', async (route) => {
    if (++names === 1) {
      await route.fulfill({
        status: 502,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://plomba.app/problems/upstream',
          title: 'Face naming unavailable',
          status: 502,
        }),
      });
    } else {
      await route.continue();
    }
  });
  await page.goto('/try');
  await page.getByRole('button', { name: /^Unlinked synthetic clip/ }).click();
  await expect(page.getByRole('alert')).toContainText('Face naming unavailable');
  await expect(page.locator('.face-outline')).toHaveCount(1);
  await expect(page.locator('.guide-grid')).toHaveCount(20);
  await expect(page.locator('.video-face-name')).toHaveCount(0);
  await expect(page.locator('.video-ar [role="status"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.video-face-name')).toHaveText('Right');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(tracks).toBe(1);
  expect(names).toBe(2);
});

test('sample photos identify the doors and go through the face and walk-around pipelines', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await page.getByRole('link', { name: 'Inspect a container', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No container here? Try a sample door photo' }),
  ).toBeVisible();
  await expect(page.locator('.sample-grid')).not.toContainText('CSQU3054383');
  await expect(page.getByRole('button', { name: /^Sample door photo 1\/1/ })).toContainText(
    'Synthetic test fixture',
  );
  await page.getByRole('button', { name: 'Język: polski' }).click();
  await expect(page.getByRole('button', { name: /^Przykładowe zdjęcie drzwi 1\/1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Language: English' }).click();
  await page.getByRole('button', { name: /^Sample door photo 1\/1/ }).click();
  await expect(page.getByRole('heading', { name: 'Check digit verified' })).toBeVisible();
  await expect(
    page.getByText('Read by Muse Spark · verified by the ISO 6346 check digit'),
  ).toBeVisible();
  await expect(page.getByText('Sample photo ·')).toContainText('Apache-2.0');
  await page.getByRole('button', { name: 'Confirm container' }).click();
  await expect(page.getByLabel('Checker', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Place', { exact: true })).toHaveValue('');
  await page.getByLabel('Checker', { exact: true }).fill('Sample checker');
  await page.getByLabel('Place', { exact: true }).fill('Sample yard');
  await page.getByRole('button', { name: 'Start handover' }).click();
  await page.getByRole('button', { name: 'Left', exact: true }).click();
  await page.getByRole('button', { name: 'Use a sample photo' }).click();
  await expect(page.getByRole('button', { name: /^Synthetic face L/ })).toContainText(
    'Synthetic test fixture',
  );
  await expect(page.getByRole('button', { name: /^Synthetic face R/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Synthetic face L/ }).click();
  await expect(page.locator('.grid-cell.covered')).toHaveCount(10);
  await expect(page.getByText('Sections with a photo: 10 of 46')).toBeVisible();
  await page.getByRole('button', { name: 'Find damage', exact: true }).click();
  await expect(page.getByText('Found by Muse Spark, outlined by SAM 3.1')).toBeVisible();

  await page.getByRole('link', { name: 'Walk-around video' }).click();
  await expect(page.getByRole('button', { name: /^Synthetic face/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Synthetic sample clip/ }).click();
  await page.getByRole('button', { name: 'Analyse the walk-around' }).click();
  await expect(page.locator('.filmstrip')).toBeVisible();
  await page.getByRole('button', { name: 'Add to the handover (photos: 1)' }).click();
  await expect(page).toHaveURL(/\/handovers\/[^/]+$/);
  // Leave the shared installation ready for other tests.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Seal handover' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sealed into the container history' }),
  ).toBeVisible();
});
