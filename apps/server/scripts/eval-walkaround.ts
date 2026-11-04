/**
 * Measures the walk-around pipeline on labelled clips, through the same
 * services the app uses: SAM 3.1 tracking, candidate frames, Muse Spark
 * naming the faces, the photos chosen, and reading the doors.
 *
 *   node --env-file=.env apps/server/scripts/eval-walkaround.ts <clips dir> <labels.json>
 *     [--only <file>] [--runs N] [--cache <dir>]
 *
 * The labels file lists, per clip (see docs/evaluation.md):
 *   { file, length, faces, wholeFaces, corner: [[left, right]], number, ... }
 * where faces use D, F, L, R, T, or S for a side whose left/right is unknown.
 *
 * Frames are cut with ffmpeg here (in the app the browser does it), so this
 * script needs ffmpeg and ffprobe on the PATH. Tracking results are cached by
 * the clip's hash, so repeated runs only pay for the face naming.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  chooseWalkaroundPhotos,
  type Face,
  harmonizeSides,
  isCornerPair,
  type PhotoChoice,
  pickCandidateFrames,
  usableSplit,
} from '@plomba/core';
import { pino } from 'pino';
import { MetaClient } from '../src/adapters/meta/client.ts';
import {
  MuseSparkFaceViewClassifier,
  MuseSparkMarkingsReader,
} from '../src/adapters/meta/muse-spark.ts';
import { Sam3Segmenter } from '../src/adapters/meta/sam.ts';
import { loadConfig } from '../src/config.ts';
import { JsonFileCache } from '../src/media/json-file-cache.ts';
import { IdentifyService } from '../src/services/identify.ts';
import { type StoredTracking, VideoService } from '../src/services/video.ts';

interface Label {
  readonly file: string;
  readonly length?: string;
  readonly wholeFaces?: readonly string[];
  readonly corner?: readonly (readonly [string, string])[];
  readonly number?: string | null;
  readonly category?: string;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: 'string' },
    runs: { type: 'string', default: '1' },
    cache: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
});
const [clipsDir, labelsFile] = positionals;
if (!clipsDir || !labelsFile) {
  console.error('Usage: eval-walkaround.ts <clips dir> <labels.json> [--only file] [--runs N]');
  process.exit(1);
}
const labels = (JSON.parse(readFileSync(labelsFile, 'utf8')) as Label[]).filter(
  (l) => !values.only || l.file === values.only,
);

const config = loadConfig();
const logger = pino({ level: 'warn' });
const meta = new MetaClient({
  baseUrl: config.meta.baseUrl,
  apiKey: config.meta.apiKey,
  timeoutMs: config.meta.timeoutMs,
  logger,
});
const { vision } = config.meta;
const visionClient = vision.baseUrl
  ? new MetaClient({
      baseUrl: vision.baseUrl,
      apiKey: vision.apiKey ?? '',
      timeoutMs: config.meta.timeoutMs,
      logger,
    })
  : meta;
const spark = {
  model: config.meta.visionModel,
  reasoningEffort: config.meta.reasoningEffort,
  api: vision.apiStyle,
};
const video = new VideoService({
  segmenter: new Sam3Segmenter(meta, { model: config.meta.segmentationModel }),
  classifier: new MuseSparkFaceViewClassifier(visionClient, {
    ...spark,
    maxImages: vision.maxImages,
  }),
  cache: new JsonFileCache<StoredTracking>(values.cache ?? join(config.dataDir, 'tracks')),
  // Each evaluation run must measure the model again, not reuse its earlier answers.
  facesCache: { get: async () => undefined, put: async () => {} },
});
const identify = new IdentifyService(new MuseSparkMarkingsReader(visionClient, spark));

function probe(file: string): { width: number; height: number } {
  const run = spawnSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    file,
  ]);
  const [width = 0, height = 0] = run.stdout.toString().trim().split(',').map(Number);
  return { width, height };
}

/** The given frames (by index), as JPEG, in one decoding pass. */
function grab(file: string, frames: readonly number[]): Uint8Array[] {
  const dir = mkdtempSync(join(tmpdir(), 'plomba-eval-'));
  try {
    const select = frames.map((n) => `eq(n\\,${n})`).join('+');
    const run = spawnSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=${select}`,
      '-fps_mode',
      'passthrough',
      '-q:v',
      '3',
      join(dir, '%04d.jpg'),
    ]);
    if (run.status !== 0) throw new Error(`ffmpeg failed on ${file}`);
    return readdirSync(dir)
      .sort()
      .map((name) => new Uint8Array(readFileSync(join(dir, name))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether a named face matches a label, where S means "a long side, L or R unknown". */
const matches = (face: Face, label: string) =>
  face === label || (label === 'S' && (face === 'L' || face === 'R'));

interface Outcome {
  readonly file: string;
  readonly tracked: string;
  readonly candidates: number;
  readonly photos: string;
  readonly expected: string;
  readonly right: number;
  readonly wrong: number;
  readonly missed: number;
  readonly sideSwaps: number;
  readonly guessedSides: number;
  readonly impossibleCorners: number;
  readonly doors: string;
  readonly seconds: number;
}

const outcomes: Outcome[] = [];
for (const label of labels) {
  const path = join(clipsDir, label.file);
  for (let run = 0; run < Number(values.runs); run++) {
    const started = performance.now();
    const data = new Uint8Array(await readFile(path));
    const tracking = await video.track(data);
    const size = probe(path);
    const fps = 15; // the test clips are cut at 15 fps: candidates at least a second apart, as in the app
    const picked = pickCandidateFrames(tracking.frames, size, { minGap: fps, max: 12 });
    let choices: PhotoChoice[] = [];
    let impossibleCorners = 0;
    let guessedSides = 0;
    let doors = '—';
    if (picked.length > 0) {
      const frames = grab(
        path,
        picked.map((c) => c.frame),
      );
      const { views: named } = await video.faces(frames);
      const { views, guessed } = harmonizeSides(
        picked.map((c, i) => ({ frame: c.frame, view: named[i] as (typeof named)[number] })),
        tracking.frames,
      );
      const splits = new Map(tracking.frames.map((f) => [f.frame, usableSplit(f.split, size)]));
      const candidates = picked.map((c, i) => ({
        ...c,
        view: views[i] ?? { face: null, squareOn: false },
        split: splits.get(c.frame) ?? null,
      }));
      if (values.verbose) {
        for (const [i, v] of views.entries()) {
          const corner = v.corner ? ` corner ${v.corner.left}|${v.corner.right}` : '';
          const doors = v.doorEnd ? ` doors-${v.doorEnd}` : '';
          console.error(
            `  frame ${picked[i]?.frame}: ${v.face ?? '-'}${v.squareOn ? ' square-on' : ''}${corner}${doors}${v.clear ? '' : ' unclear'} ${Math.round(v.confidence * 100)}% "${v.note}"`,
          );
        }
      }
      impossibleCorners = views.filter(
        (v) => v.corner && !isCornerPair(v.corner.left, v.corner.right),
      ).length;
      choices = chooseWalkaroundPhotos(candidates);
      guessedSides = choices.filter((c) => c.part === 'whole' && guessed.has(c.index)).length;
      const door = choices.find((c) => c.face === 'D');
      const doorFrame = door ? frames[door.index] : undefined;
      if (doorFrame) {
        const read = await identify.identify(doorFrame);
        doors =
          read.verdict === 'verified'
            ? read.containerNumber === label.number
              ? 'right'
              : label.number
                ? `wrong (${read.containerNumber})`
                : `read ${read.containerNumber}`
            : read.verdict;
      }
    }
    // What should be found: faces wholly in view, and both faces of eye-level corners.
    const expected = [...new Set([...(label.wholeFaces ?? []), ...(label.corner ?? []).flat()])];
    const found = [...new Set(choices.map((c) => c.face))];
    const right = found.filter((f) => expected.some((e) => matches(f, e))).length;
    const sideSwaps = found.filter(
      (f) =>
        (f === 'L' && expected.includes('R') && !expected.includes('L')) ||
        (f === 'R' && expected.includes('L') && !expected.includes('R')),
    ).length;
    outcomes.push({
      file: label.file,
      tracked: `${tracking.frames.length}/${tracking.frameCount}`,
      candidates: picked.length,
      photos: choices.map((c) => `${c.face}${c.part === 'whole' ? '' : `(${c.part})`}`).join(' '),
      expected: expected.join(' '),
      right,
      wrong: found.length - right,
      missed: expected.filter((e) => !found.some((f) => matches(f, e))).length,
      sideSwaps,
      guessedSides,
      impossibleCorners,
      doors,
      seconds: (performance.now() - started) / 1000,
    });
    process.stderr.write(`\r${outcomes.length} clip runs`);
  }
}

const sum = (key: keyof Outcome) => outcomes.reduce((s, o) => s + Number(o[key]), 0);
const rows = outcomes.map(
  (o) =>
    `| ${o.file} | ${o.tracked} | ${o.candidates} | ${o.photos || '—'} | ${o.expected || '—'} | ${o.right} | ${o.wrong} | ${o.missed} | ${o.sideSwaps} | ${o.guessedSides} | ${o.doors} | ${o.seconds.toFixed(0)} s |`,
);
const report = `Model: ${config.meta.visionModel}, ${outcomes.length} clip runs

| Clip | Tracked | Candidates | Photos chosen | Expected | Right | Wrong | Missed | L/R swapped | Side guessed | Doors | Time |
|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

**Faces chosen:** ${sum('right')} right, ${sum('wrong')} wrong (of which ${sum('sideSwaps')} left/right swapped), ${sum('missed')} expected faces missed. Sides chosen without the doors in view (flagged to the checker): ${sum('guessedSides')}. Impossible corner pairs dropped: ${sum('impossibleCorners')}.`;
console.log(`\n${report}`);
const out = join(
  dirname(labelsFile),
  `walkaround-results-${new Date().toISOString().slice(0, 16).replace(':', '')}.md`,
);
await writeFile(out, `${report}\n`);
console.error(`Report: ${out}`);
