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

/**
 * The README image is four phone screens (780 × 1688 each) in a row, with a
 * 44 px margin around and between them, scaled to the image's width. The
 * site shows the last three: the walk-around, a handover and the passport.
 */
const PANEL = { width: 780, height: 1688, gap: 44, count: 4 } as const;
const SCREENS = ['screen-walkaround', 'screen-handover', 'screen-passport'] as const;
const FIRST_SCREEN = 1;

/** Where each phone screen sits in the source, inset a pixel to stay clear of the rounded corners' edge. */
async function screenRegions(): Promise<Map<string, Region>> {
  const { width = 0 } = await sharp(SOURCE).metadata();
  const scale = width / (PANEL.count * PANEL.width + (PANEL.count + 1) * PANEL.gap);
  const regions = new Map<string, Region>();
  SCREENS.forEach((name, i) => {
    const left = (PANEL.gap + (FIRST_SCREEN + i) * (PANEL.width + PANEL.gap)) * scale;
    regions.set(name, {
      left: Math.ceil(left),
      top: Math.ceil(PANEL.gap * scale),
      width: Math.floor(PANEL.width * scale) - 1,
      height: Math.floor(PANEL.height * scale) - 1,
    });
  });
  return regions;
}

const JPEG = { quality: 84, mozjpeg: true, progressive: true } as const;

async function cropScreens(): Promise<Buffer[]> {
  const crops: Buffer[] = [];
  for (const [name, region] of await screenRegions()) {
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
  const phoneWidth = Math.round((PANEL.width / PANEL.height) * phoneHeight);
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
