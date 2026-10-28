import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const photo = join(import.meta.dirname, 'fixtures', 'container-side.jpg');

test('a checker identifies a container, records damage, seals the handover and sends CODECO', async ({
  page,
}) => {
  await page.goto('/');
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
  await expect(page.getByLabel('Seal numbers, comma-separated')).toHaveValue('PL123456');
  await page.getByRole('button', { name: 'Start handover' }).click();

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

  // The container's history verifies.
  await page.goto('/containers/CSQU3054383');
  await expect(page.getByText('History intact · sealed handovers: 1')).toBeVisible();
});
