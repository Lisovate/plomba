/**
 * Synthetic robustness tests for damage detection. Muse Image adds a known
 * damage to a clean container photo; the production detector (Muse Spark,
 * then SAM 3.1) must find it. Every generated image is labelled SYNTHETIC in
 * its pixels and its file name, and these results are never counted in
 * reported accuracy.
 *
 *   node --env-file=.env apps/server/scripts/synthetic-damage.ts <clean photo> <output dir>
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pino } from 'pino';
import sharp from 'sharp';
import { MetaClient, toDataUrl } from '../src/adapters/meta/client.ts';
import { MuseSparkDamageDetector } from '../src/adapters/meta/muse-spark.ts';
import { loadConfig } from '../src/config.ts';
import { normaliseImage } from '../src/media/images.ts';

const IMAGE_MODEL = 'muse-image-1.0';

/** Each case asks for one damage the detector should report, or none. */
const CASES = [
  {
    id: 'dent',
    expected: ['DT', 'BW', 'BT'],
    prompt:
      'Add one large dent, about a metre across, pushed into the corrugated side panel of the shipping container, low on the left. Keep everything else unchanged.',
  },
  {
    id: 'hole',
    expected: ['HO', 'CU', 'BR'],
    prompt:
      'Add one jagged hole torn through the side panel of the shipping container, about 30 cm wide, in the middle. Keep everything else unchanged.',
  },
  {
    id: 'corrosion',
    expected: ['CO', 'PH'],
    prompt:
      'Add a heavy patch of rust corrosion with flaking paint on the lower right of the shipping container side panel. Keep everything else unchanged.',
  },
  {
    id: 'bent-rail',
    expected: ['BT', 'DT', 'BW', 'BR'],
    prompt:
      'Bend the bottom rail of the shipping container visibly upwards near the middle, as if hit by a forklift. Keep everything else unchanged.',
  },
  {
    id: 'dirt-only',
    expected: [],
    prompt:
      'Add mud splashes and road dirt to the lower part of the shipping container side, without any damage to the metal. Keep everything else unchanged.',
  },
] as const;

const [photoPath, outDir] = process.argv.slice(2);
if (!photoPath || !outDir) {
  console.error('Usage: synthetic-damage.ts <clean photo> <output dir>');
  process.exit(1);
}

const config = loadConfig();
const client = new MetaClient({
  baseUrl: config.meta.baseUrl,
  apiKey: config.meta.apiKey,
  timeoutMs: 180_000,
  logger: pino({ level: 'warn' }),
});
const detector = new MuseSparkDamageDetector(client, {
  model: config.meta.visionModel,
  reasoningEffort: config.meta.reasoningEffort,
});

/** Burns a label into the image so it can never pass for a real photo. */
async function labelSynthetic(data: Uint8Array): Promise<Uint8Array> {
  const { width = 1024 } = await sharp(data).metadata();
  const height = Math.round(width / 18);
  const label =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#000" fill-opacity="0.6"/>
    <text x="12" y="${height * 0.72}" font-family="sans-serif" font-size="${height * 0.6}" fill="#ffc20e">SYNTHETIC · Muse Image · not a real photo</text>
  </svg>`);
  return new Uint8Array(
    await sharp(data)
      .composite([{ input: label, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer(),
  );
}

await mkdir(outDir, { recursive: true });
const clean = await normaliseImage(new Uint8Array(await readFile(photoPath)), 1536);
const rows: string[] = [];
for (const testCase of CASES) {
  const edited = await client.editImage({
    model: IMAGE_MODEL,
    prompt: testCase.prompt,
    images: [{ image_url: toDataUrl(clean) }],
    output_format: 'jpeg',
  });
  const b64 = edited.data[0]?.b64_json;
  if (!b64) throw new Error(`Muse Image returned no image for ${testCase.id}`);
  const labelled = await labelSynthetic(new Uint8Array(Buffer.from(b64, 'base64')));
  const file = join(outDir, `synthetic-${testCase.id}.jpg`);
  await writeFile(file, labelled);

  const image = await normaliseImage(labelled);
  const findings = await detector.detect(image);
  const codes = findings.map((f) => `${f.damageCode} ${Math.round(f.confidence * 100)}%`);
  const pass =
    testCase.expected.length === 0
      ? findings.length === 0
      : findings.some((f) => (testCase.expected as readonly string[]).includes(f.damageCode));
  rows.push(
    `| ${testCase.id} | ${testCase.expected.join(', ') || 'none'} | ${codes.join(', ') || 'none'} | ${pass ? 'yes' : 'no'} |`,
  );
  console.error(`${testCase.id}: ${codes.join(', ') || 'none'} → ${file}`);
}

console.log(`| Synthetic case | Expected | Found by Muse Spark | Pass |
|---|---|---|---|
${rows.join('\n')}`);
