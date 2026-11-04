/**
 * Blurs people and number plates before a clip is shared as a sample.
 *
 *   node --env-file=.env apps/server/scripts/blur-clip.ts <in.mp4> <out.mp4>
 *
 * Uses the same redactor as handover video evidence. Needs ffmpeg and ffprobe
 * on the PATH. Whole people are covered, since faces can be too small to find.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { pino } from 'pino';
import { MetaClient } from '../src/adapters/meta/client.ts';
import { Sam3Segmenter } from '../src/adapters/meta/sam.ts';
import { loadConfig } from '../src/config.ts';
import { FfmpegVideoRedactor } from '../src/media/ffmpeg-video-redactor.ts';
import { videoType } from '../src/services/video.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: blur-clip.ts <in.mp4> <out.mp4>');
  process.exit(1);
}

const config = loadConfig();
const client = new MetaClient({
  baseUrl: config.meta.baseUrl,
  apiKey: config.meta.apiKey,
  timeoutMs: config.meta.timeoutMs,
  logger: pino({ level: 'warn' }),
});
const segmenter = new Sam3Segmenter(client, { model: config.meta.segmentationModel });
const redactor = new FfmpegVideoRedactor(segmenter);
const data = new Uint8Array(await readFile(input));
const result = await redactor.redact({ data, mimeType: videoType(data) });
await writeFile(output, result.data);
console.log(`${output}: blurred ${result.regions} regions (people and number plates)`);
