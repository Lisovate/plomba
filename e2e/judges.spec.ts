import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  type ClaimResult,
  ContainerHistorySchema,
  HandoverSchema,
  MarkSchema,
  PhotoSchema,
} from '@plomba/contracts';

test.use({ serviceWorkers: 'block' });

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(`/api${path}`, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('the demo tour links to existing stories and resolves the open handover from history', async ({
  page,
}, testInfo) => {
  for (const number of ['PLBU4000172', 'PLBU4000043', 'MSCU9749070']) {
    const registered = await page.request.post('/api/containers', {
      data: { number, sizeTypeCode: '22G1' },
    });
    expect(registered.ok(), await registered.text()).toBe(true);
  }
  const started = await page.request.post('/api/handovers', {
    data: {
      containerNumber: 'PLBU4000043',
      direction: 'out',
      place: 'Łódź',
      checker: 'Tour checker',
    },
  });
  expect(started.ok(), await started.text()).toBe(true);
  const open = HandoverSchema.parse(await started.json());
  // The recent page need not include the featured handover.
  await page.route('**/api/handovers', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  const tour = page.locator('.card', { has: page.getByRole('heading', { name: 'Start here' }) });
  await expect(tour.getByRole('link')).toHaveCount(5);
  await expect(tour.getByRole('link', { name: 'See the AR on sample footage' })).toHaveAttribute(
    'href',
    '/try',
  );
  await expect(
    tour.getByRole('link', { name: 'Damage placed between two handovers' }),
  ).toHaveAttribute('href', '/containers/PLBU4000172');
  await expect(
    tour.getByRole('link', { name: "Last handover's damage on a new photo" }),
  ).toHaveAttribute('href', `/handovers/${open.id}`);
  await expect(tour.getByRole('link', { name: "A container's sealed history" })).toHaveAttribute(
    'href',
    '/containers/MSCU9749070',
  );
  await expect(tour.getByRole('link', { name: 'The API' })).toHaveAttribute(
    'href',
    '/api/openapi.json',
  );
  await page.screenshot({ path: testInfo.outputPath('home-en.png') });
  await page.getByRole('button', { name: 'Język: polski' }).click();
  await expect(page.getByRole('heading', { name: 'Zacznij tutaj' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Uszkodzenie z ostatniego przekazania na nowym zdjęciu' }),
  ).toHaveAttribute('href', `/handovers/${open.id}`);
  await page.screenshot({ path: testInfo.outputPath('home-pl.png') });

  const closed = await page.request.post(`/api/handovers/${open.id}/close`, {
    data: { acceptGaps: true },
  });
  expect(closed.ok(), await closed.text()).toBe(true);
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Uszkodzenie z ostatniego przekazania na nowym zdjęciu' }),
  ).toHaveCount(0);

  await page.route('**/api/containers', (route) => route.fulfill({ json: [] }));
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Zobacz AR na przykładowym nagraniu' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zaplombowana historia kontenera' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Uszkodzenie powstałe między dwoma przekazaniami' }),
  ).toHaveCount(0);

  await page.route('**/api/samples', (route) => route.fulfill({ json: [] }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Zacznij tutaj' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sprawdź kontener', exact: true })).toHaveAttribute(
    'href',
    '/identify',
  );
});

test('the passport opens the claim on the handover that first recorded the damage', async ({
  page,
}) => {
  const number = 'PLBU4000172';
  await post(page.request, '/containers', { number, sizeTypeCode: '22G1' });
  const first = HandoverSchema.parse(
    await post(page.request, '/handovers', {
      containerNumber: number,
      direction: 'in',
      place: 'Gdynia',
      checker: 'Claim checker',
    }),
  );
  const uploaded = await page.request.post(`/api/handovers/${first.id}/photos`, {
    multipart: {
      face: 'R',
      image: {
        name: 'side.jpg',
        mimeType: 'image/jpeg',
        buffer: readFileSync(join(import.meta.dirname, 'fixtures', 'container-side.jpg')),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  PhotoSchema.parse(await uploaded.json());
  // Damage already present at the first record has no known interval to claim for.
  await post(page.request, `/handovers/${first.id}/marks`, {
    face: 'L',
    rect: { u0: 2, v0: 0.3, u1: 3, v1: 0.7 },
    damageCode: 'CO',
  });
  await post(page.request, `/handovers/${first.id}/close`, { acceptGaps: true });
  const second = HandoverSchema.parse(
    await post(page.request, '/handovers', {
      containerNumber: number,
      direction: 'out',
      place: 'Łódź',
      checker: 'Claim checker',
    }),
  );
  const dent = MarkSchema.parse(
    await post(page.request, `/handovers/${second.id}/marks`, {
      face: 'R',
      rect: { u0: 2, v0: 0.3, u1: 3, v1: 0.7 },
      damageCode: 'DT',
    }),
  );
  await post(page.request, `/handovers/${second.id}/close`, { acceptGaps: true });
  const third = HandoverSchema.parse(
    await post(page.request, '/handovers', {
      containerNumber: number,
      direction: 'in',
      place: 'Poznań',
      checker: 'Claim checker',
    }),
  );
  await post(page.request, `/handovers/${third.id}/marks`, {
    face: dent.face,
    rect: dent.rect,
    damageCode: dent.damageCode,
    previousMarkId: dent.id,
    status: 'still-there',
  });
  await post(page.request, `/handovers/${third.id}/close`, { acceptGaps: true });
  const history = ContainerHistorySchema.parse(
    await (await page.request.get(`/api/containers/${number}`)).json(),
  );
  expect(history.damage.find((d) => d.id === dent.id)?.lastClear).toBe(first.id);

  await page.goto(`/containers/${number}`);
  const claimLink = page.getByRole('link', { name: 'Draft the claim (Muse Spark)' });
  await expect(claimLink).toHaveCount(1);
  await expect(claimLink).toHaveAttribute('href', `/handovers/${second.id}/report`);
  await page.getByRole('button', { name: 'Język: polski' }).click();
  await expect(
    page.getByRole('link', { name: 'Przygotuj reklamację (Muse Spark)' }),
  ).toHaveAttribute('href', `/handovers/${second.id}/report`);
  await page.getByRole('button', { name: 'Language: English' }).click();
  await claimLink.click();
  await expect(page).toHaveURL(new RegExp(`/handovers/${second.id}/report$`));
  await expect(page.getByRole('heading', { name: 'Damage claim', exact: true })).toBeVisible();
  // Keep this a navigation/UI test; the claim service separately verifies model drafts.
  const draft: ClaimResult = {
    status: 'drafted',
    claim: {
      addressee: 'Carrier',
      subject: `Damage on ${number}`,
      summary: 'New dent',
      items: [],
      letter: 'Please review the sealed evidence for the new dent.',
    },
    verification: { attempts: 1, toolCalls: [], checks: [] },
  };
  await page.route(`**/api/handovers/${second.id}/claim`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ language: 'en' });
    await route.fulfill({ json: draft });
  });
  await page.getByRole('button', { name: 'Draft a claim with Muse Spark' }).click();
  await expect(
    page.getByText('Drafted by a Muse Spark agent, checked against the sealed records'),
  ).toBeVisible();
  await expect(page.locator('.letter')).toHaveText(draft.claim.letter);
  await page.getByRole('button', { name: 'Język: polski' }).click();
  await expect(
    page.getByText('Przygotowane przez agenta Muse Spark, sprawdzone z zaplombowanymi rekordami'),
  ).toBeVisible();
});
