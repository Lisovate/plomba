/**
 * Renders the app icon (a container door end closed with a seal) to the PNG
 * sizes iOS and Android expect. Run with `npm run icons --workspace @plomba/web`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const NAVY = '#0b1d33';
const WHITE = '#f4f6f8';
const SEAL = '#ffc20e';

const artwork = `
  <rect x="112" y="104" width="288" height="304" rx="12" fill="none" stroke="${WHITE}" stroke-width="20"/>
  <line x1="256" y1="104" x2="256" y2="408" stroke="${WHITE}" stroke-width="12"/>
  ${[164, 204, 308, 348]
    .map((x) => {
      // Locking bars, each with a cam handle turned towards the middle of the doors.
      const handle = x < 256 ? x + 26 : x - 26;
      return (
        `<line x1="${x}" y1="132" x2="${x}" y2="380" stroke="${WHITE}" stroke-width="12" stroke-linecap="round"/>` +
        `<line x1="${x}" y1="236" x2="${handle}" y2="236" stroke="${WHITE}" stroke-width="10" stroke-linecap="round"/>`
      );
    })
    .join('')}
  <path d="M230 284 v-22 a26 26 0 0 1 52 0 v22" fill="none" stroke="${SEAL}" stroke-width="14" stroke-linecap="round"/>
  <rect x="218" y="276" width="76" height="92" rx="16" fill="${SEAL}"/>
  <circle cx="256" cy="310" r="11" fill="${NAVY}"/>`;

/** Rounded tile for browsers and Android launchers that don't mask. */
const standard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <title>Plomba</title>
  <rect width="512" height="512" rx="112" fill="${NAVY}"/>${artwork}</svg>`;

/** Full-bleed square, artwork inside the 80% safe zone, for maskable icons and iOS. */
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <title>Plomba</title>
  <rect width="512" height="512" fill="${NAVY}"/>
  <g transform="translate(51.2 51.2) scale(0.8)">${artwork}</g></svg>`;

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const render = (svg: string, size: number, name: string) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(outDir, name));

await Promise.all([
  render(standard, 192, 'icon-192.png'),
  render(standard, 512, 'icon-512.png'),
  render(fullBleed, 512, 'icon-maskable-512.png'),
  render(fullBleed, 180, 'apple-touch-icon.png'),
]);
writeFileSync(join(outDir, 'favicon.svg'), standard);
console.log(`Icons written to ${outDir}`);
