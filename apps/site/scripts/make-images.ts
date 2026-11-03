/**
 * Cuts the three app screens out of the README image and composes the social
 * preview image. Run with `npm run images --workspace @plomba/site` after the
 * source image changes; the results are committed in public/images.
 *
 * The photos inside the screens are CC BY 3.0 frames; src/images.ts credits them.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SOURCE = fileURLToPath(new URL('../../../docs/images/screens.jpg', import.meta.url));
const LOGO = fileURLToPath(new URL('../../web/public/icons/favicon.svg', import.meta.url));
const OUT = fileURLToPath(new URL('../public/images/', import.meta.url));

const NAVY = '#0b1d33';
const SEAL = '#ffc20e';

interface Region {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where each phone screen sits in the 1500 × 1057 source, found by its navy app bar. */
const SCREENS: Readonly<Record<string, Region>> = {
  'screen-walkaround': { left: 29, top: 29, width: 461, height: 997 },
  'screen-handover': { left: 519, top: 29, width: 461, height: 997 },
  'screen-passport': { left: 1010, top: 29, width: 461, height: 997 },
};

const JPEG = { quality: 84, mozjpeg: true, progressive: true } as const;

async function cropScreens(): Promise<Buffer[]> {
  const crops: Buffer[] = [];
  for (const [name, region] of Object.entries(SCREENS)) {
    const crop = await sharp(SOURCE).extract(region).jpeg(JPEG).toBuffer();
    await sharp(crop).toFile(`${OUT}${name}.jpg`);
    crops.push(crop);
  }
  return crops;
}

/** 1200 × 630 for link previews: the logo on navy beside the three screens. */
async function socialImage(screens: readonly Buffer[]): Promise<void> {
  const width = 1200;
  const height = 630;
  const phoneHeight = 520;
  const phoneWidth = Math.round((461 / 997) * phoneHeight);
  const gap = 20;
  const firstLeft = width - 64 - screens.length * phoneWidth - (screens.length - 1) * gap;

  const phones = await Promise.all(
    screens.map((screen) =>
      sharp(screen)
        .resize({ width: phoneWidth, height: phoneHeight, fit: 'fill' })
        .composite([{ input: roundedRect(phoneWidth, phoneHeight, 22), blend: 'dest-in' }])
        .png()
        .toBuffer(),
    ),
  );
  const logo = await sharp(readFileSync(LOGO)).resize(232, 232).png().toBuffer();
  const sealBar = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="12"><rect width="${width}" height="12" fill="${SEAL}"/></svg>`,
  );

  await sharp({ create: { width, height, channels: 3, background: NAVY } })
    .composite([
      { input: logo, left: 84, top: (height - 232) / 2 - 6 },
      ...phones.map((input, i) => ({
        input,
        left: firstLeft + i * (phoneWidth + gap),
        top: i === 1 ? 34 : 70,
      })),
      { input: sealBar, left: 0, top: height - 12 },
    ])
    .jpeg(JPEG)
    .toFile(`${OUT}social.jpg`);
}

function roundedRect(width: number, height: number, radius: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}"/></svg>`,
  );
}

mkdirSync(OUT, { recursive: true });
await socialImage(await cropScreens());
console.log(`Images written to ${OUT}`);
