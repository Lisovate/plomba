/**
 * Makes the synthetic photo and clip the end-to-end tests upload: a red 20 ft container
 * side on a grey yard, head-on. Run with ffmpeg installed; the output is committed.
 * Original test artwork, Apache-2.0; never used for reported accuracy.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const ribs = Array.from({ length: 30 }, (_, i) => {
  const x = 140 + i * 31;
  return `<rect x="${x}" y="230" width="9" height="400" fill="#9e2a1e"/>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="#b8bcc2"/>
  <rect y="640" width="1200" height="160" fill="#6d7075"/>
  <rect x="120" y="210" width="960" height="440" fill="#c0392b" stroke="#7b241c" stroke-width="10"/>
  ${ribs}
</svg>`;

const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
writeFileSync(join(here, 'container-side.jpg'), jpeg);
console.log('Wrote e2e/fixtures/container-side.jpg');

execFileSync('ffmpeg', [
  '-v',
  'error',
  '-loop',
  '1',
  '-i',
  join(here, 'container-side.jpg'),
  '-t',
  '2',
  '-r',
  '10',
  '-c:v',
  'libx264',
  '-profile:v',
  'baseline',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '-y',
  join(here, 'container-side.mp4'),
]);
console.log('Wrote e2e/fixtures/container-side.mp4');
