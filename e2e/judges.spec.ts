import { expect, test } from '@playwright/test';
import { HandoverSchema } from '@plomba/contracts';

test.use({ serviceWorkers: 'block' });

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
