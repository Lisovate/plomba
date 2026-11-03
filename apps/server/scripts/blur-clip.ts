/**
 * Blurs every person and number plate in a clip before it's shared, e.g. as
 * a sample clip of an installation: SAM 3.1 tracks each concept through the
 * clip, and the app's own `blurRegions` covers them frame by frame.
 *
 *   node --env-file=.env apps/server/scripts/blur-clip.ts <in.mp4> <out.mp4>
 *
 * Needs ffmpeg on the PATH to split the clip into frames and join them again
 * (the server itself never decodes video). Whole people are blurred, not just
 * faces: in walk-around footage they are often too small for a face to be
 * found, yet still worth covering.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import sharp from 'sharp';
import { MetaClient } from '../src/adapters/meta/client.ts';
import { Sam3Segmenter } from '../src/adapters/meta/sam.ts';
import { loadConfig } from '../src/config.ts';
import { blurRegions } from '../src/media/images.ts';
import type { PixelBox } from '../src/ports.ts';
import { videoType } from '../src/services/video.ts';

const CONCEPTS = ['person', 'license plate'];

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: blur-clip.ts <in.mp4> <out.mp4>');
  process.exit(1);
}

function ffmpeg(...args: string[]): void {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed`);
}

function frameRate(file: string): string {
  const run = spawnSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=r_frame_rate',
    '-of',
    'csv=p=0',
    file,
  ]);
  return run.stdout.toString().trim() || '15';
}

const config = loadConfig();
const client = new MetaClient({
  baseUrl: config.meta.baseUrl,
  apiKey: config.meta.apiKey,
  timeoutMs: config.meta.timeoutMs,
  logger: pino({ level: 'warn' }),
});
const segmenter = new Sam3Segmenter(client, { model: config.meta.segmentationModel });

const data = new Uint8Array(await readFile(input));
const video = { data, mimeType: videoType(data) };
const boxes = new Map<number, PixelBox[]>();
for (const concept of CONCEPTS) {
  for (const { frame, objects } of await segmenter.track(video, concept)) {
    boxes.set(frame, [...(boxes.get(frame) ?? []), ...objects.map((o) => o.box)]);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'plomba-blur-'));
try {
  ffmpeg('-i', input, join(dir, '%06d.png'));
  const files = readdirSync(dir).sort();
  let blurred = 0;
  for (const [index, file] of files.entries()) {
    const regions = boxes.get(index) ?? [];
    if (regions.length === 0) continue;
    const path = join(dir, file);
    const png = await readFile(path);
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const jpeg = await sharp(png).jpeg({ quality: 95 }).toBuffer();
    const result = await blurRegions(
      { data: new Uint8Array(jpeg), mimeType: 'image/jpeg', width, height },
      regions,
    );
    await writeFile(path, await sharp(result.data).png().toBuffer());
    blurred++;
  }
  ffmpeg(
    '-framerate',
    frameRate(input),
    '-i',
    join(dir, '%06d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '23',
    '-movflags',
    '+faststart',
    output,
  );
  console.log(`${output}: blurred ${blurred} of ${files.length} frames (${CONCEPTS.join(', ')})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
