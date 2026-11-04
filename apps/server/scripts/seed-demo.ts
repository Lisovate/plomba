/**
 * Builds the demo installation's data: the story in `demo/scenario.ts`,
 * recorded through the real services into a fresh data directory, as if
 * checkers had used Plomba for three weeks.
 *
 * - The clock is scripted, so each handover starts at its scenario time and
 *   its photos, marks and seal follow minutes later.
 * - Photos are frames of openly licensed clips; SAM 3.1 registers each one
 *   and blurs people and number plates, as for any upload.
 * - Where the scenario asks, Muse Spark looks for damage and its proposals
 *   are confirmed; damage recorded at the last handover is confirmed as
 *   still there; every handover not left open is sealed into its
 *   container's hash chain.
 *
 *   DATA_DIR=/tmp/plomba-demo node --env-file=../../.env scripts/seed-demo.ts \
 *     --clips ~/.local/share/plomba-demo-videos/clips --videos <the same clips, blurred>
 *
 * Needs ffmpeg to cut frames. Refuses a data directory that already has data.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { FaceView } from '@plomba/contracts';
import { harmonizeSides, pickCandidateFrames } from '@plomba/core';
import { pino } from 'pino';
import { MetaClient } from '../src/adapters/meta/client.ts';
import {
  MuseSparkDamageDetector,
  MuseSparkFaceViewClassifier,
} from '../src/adapters/meta/muse-spark.ts';
import { Sam3Segmenter } from '../src/adapters/meta/sam.ts';
import { createTransactionRunner, openDatabase } from '../src/adapters/sqlite/database.ts';
import {
  SqliteContainerRepository,
  SqliteHandoverRepository,
  SqliteMarkRepository,
  SqlitePhotoRepository,
  SqliteVideoRepository,
} from '../src/adapters/sqlite/repositories.ts';
import { loadConfig } from '../src/config.ts';
import { FileMediaStore } from '../src/media/file-media-store.ts';
import { JsonFileCache } from '../src/media/json-file-cache.ts';
import { HandoverService } from '../src/services/handovers.ts';
import { VideoService } from '../src/services/video.ts';
import { type ContainerSpec, type HandoverSpec, SCENARIO } from './demo/scenario.ts';

const { values } = parseArgs({
  options: { clips: { type: 'string' }, videos: { type: 'string' } },
});
const clipsDir = values.clips;
if (!clipsDir) throw new Error('Pass --clips <folder with the scenario clips>');
// Walk-around videos are stored as they are, so they come from copies with people and plates blurred.
const videosDir = values.videos;

const config = loadConfig();
const dbPath = join(config.dataDir, 'plomba.db');
if (existsSync(dbPath)) throw new Error(`${dbPath} exists: seed into an empty data directory`);
mkdirSync(config.dataDir, { recursive: true });

/**
 * The scripted clock: set to each handover's start, then moving on by a
 * plausible few seconds to a minute with every step the checker takes.
 */
let current = new Date(0);
const clock = {
  now: () => {
    current = new Date(current.getTime() + 8_000 + Math.round(Math.random() * 40_000));
    return current;
  },
};

const logger = pino({ level: 'warn' });
const db = openDatabase(dbPath);
const meta = new MetaClient({
  baseUrl: config.meta.baseUrl,
  apiKey: config.meta.apiKey,
  timeoutMs: config.meta.timeoutMs,
  logger,
});
const vision = config.meta.vision.baseUrl
  ? new MetaClient({
      baseUrl: config.meta.vision.baseUrl,
      apiKey: config.meta.vision.apiKey ?? '',
      timeoutMs: config.meta.timeoutMs,
      logger,
    })
  : meta;
const segmenter = new Sam3Segmenter(meta, { model: config.meta.segmentationModel });
const spark = {
  model: config.meta.visionModel,
  reasoningEffort: config.meta.reasoningEffort,
  api: config.meta.vision.apiStyle,
};
const video = new VideoService({
  segmenter,
  classifier: new MuseSparkFaceViewClassifier(vision, {
    ...spark,
    maxImages: config.meta.vision.maxImages,
  }),
  cache: new JsonFileCache(join(config.dataDir, 'tracks')),
});
const handovers = new HandoverService({
  containers: new SqliteContainerRepository(db),
  handovers: new SqliteHandoverRepository(db),
  photos: new SqlitePhotoRepository(db),
  marks: new SqliteMarkRepository(db),
  videos: new SqliteVideoRepository(db),
  media: new FileMediaStore(join(config.dataDir, 'media')),
  segmenter,
  detector: new MuseSparkDamageDetector(vision, spark),
  transaction: createTransactionRunner(db),
  clock,
  newId: randomUUID,
  ediSenderId: config.ediSenderId,
});

/** One frame of a clip as a JPEG. */
function frame(path: string, at: number): Uint8Array {
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(at), '-i', path].concat([
      '-frames:v',
      '1',
      '-q:v',
      '2',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ]),
    { maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0 || result.stdout.length === 0) {
    throw new Error(`ffmpeg could not cut ${path} at ${at}s: ${result.stderr.toString()}`);
  }
  return new Uint8Array(result.stdout);
}

/** A clip's pixel size and duration, from ffprobe. */
function probe(path: string): { width: number; height: number; duration: number } {
  const result = spawnSync('ffprobe', [
    ...[
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
    ],
    ...['-of', 'json', path],
  ]);
  const info = JSON.parse(result.stdout.toString()) as {
    streams: { width: number; height: number }[];
    format: { duration: string };
  };
  const stream = info.streams[0];
  if (!stream) throw new Error(`${path} has no video stream`);
  return { width: stream.width, height: stream.height, duration: Number(info.format.duration) };
}

const UNNAMED: FaceView = {
  face: null,
  squareOn: false,
  corner: null,
  doorEnd: null,
  clear: false,
  confidence: 0,
  note: '',
};

/**
 * Keeps a walk-around clip with the handover, as the app does: SAM 3.1 tracks
 * it (cached, so it replays with its outline), Muse Spark names the faces in
 * the frames the app would pick, and the clip is stored with those views.
 */
async function addVideo(handoverId: string, clip: string): Promise<void> {
  if (!videosDir) return;
  const path = join(videosDir, clip);
  const data = new Uint8Array(readFileSync(path));
  const tracking = await video.track(data);
  const { width, height, duration } = probe(path);
  const fps = tracking.frameCount / (duration || 1);
  const picked = pickCandidateFrames(
    tracking.frames,
    { width, height },
    { minGap: Math.max(1, Math.round(fps)), max: 12 },
  );
  if (picked.length === 0) {
    console.log(`    video ${clip}: no usable frames, not kept`);
    return;
  }
  const { views: named } = await video.faces(picked.map((c) => frame(path, (c.frame + 0.5) / fps)));
  const { views } = harmonizeSides(
    picked.map((c, i) => ({ frame: c.frame, view: named[i] ?? UNNAMED })),
    tracking.frames,
  );
  await handovers.addVideo(handoverId, {
    data,
    views: picked.map((c, i) => ({ frame: c.frame, view: views[i] ?? UNNAMED })),
  });
  const faces = views.map((v) => v.face ?? '-').join('');
  console.log(
    `    video ${clip}: ${tracking.frames.length}/${tracking.frameCount} frames tracked, faces ${faces}`,
  );
}

async function record(container: ContainerSpec, spec: HandoverSpec): Promise<void> {
  current = new Date(new Date(spec.at).getTime() - 10_000);
  const handover = handovers.start({
    containerNumber: container.number,
    direction: spec.direction,
    place: spec.place,
    checker: spec.checker,
    sealNumbers: [...(spec.sealNumbers ?? [])],
    ...(spec.transportMode ? { transportMode: spec.transportMode } : {}),
    ...(spec.vehicleId ? { vehicleId: spec.vehicleId } : {}),
    ...(spec.handedOverBy ? { handedOverBy: spec.handedOverBy } : {}),
    ...(spec.receivedBy ? { receivedBy: spec.receivedBy } : {}),
  });

  // What the last handover recorded, confirmed first, as the checker would on arrival.
  const { previousMarks } = handovers.detail(handover.id);
  for (const previous of previousMarks.filter((m) => m.status !== 'repaired')) {
    if (spec.open) break; // left for the checker to confirm on the new photos
    handovers.addMark(handover.id, {
      face: previous.face,
      rect: {
        u0: previous.rect.u0,
        v0: previous.rect.v0,
        u1: previous.rect.u1,
        v1: previous.rect.v1,
      },
      outline: previous.outline,
      damageCode: previous.damageCode,
      componentCode: previous.componentCode,
      status: 'still-there',
      source: 'confirmed',
      previousMarkId: previous.id,
      photoId: null,
      note: previous.note,
    });
  }

  for (const photoSpec of spec.photos ?? []) {
    const photo = await handovers.addPhoto(handover.id, {
      face: photoSpec.face,
      data: frame(join(clipsDir as string, photoSpec.frame.clip), photoSpec.frame.at),
      capturedAt: clock.now().toISOString(),
    });
    const registered = photo.corners ? 'registered' : 'NOT registered';
    console.log(`    photo ${photoSpec.face}: ${registered}, ${photo.redactedRegions} blurred`);
    if (photoSpec.findDamage && photo.corners) {
      const proposals = await handovers.proposeDamage(handover.id, photo.id);
      for (const mark of proposals) {
        handovers.updateMark(handover.id, mark.id, { source: 'confirmed' });
      }
      console.log(
        `    damage: ${proposals.map((m) => `${m.locationCode} ${m.damageCode}`).join(', ') || 'none'}`,
      );
    }
  }

  if (spec.video) await addVideo(handover.id, spec.video);

  for (const mark of spec.marks ?? []) {
    handovers.addMark(handover.id, {
      face: mark.face,
      rect: mark.rect,
      outline: null,
      damageCode: mark.damageCode,
      componentCode: mark.componentCode ?? null,
      status: 'new',
      source: 'confirmed',
      previousMarkId: null,
      photoId: null,
      note: mark.note ?? null,
    });
  }

  if (!spec.open) await handovers.close(handover.id, { acceptGaps: true });
  console.log(`  ${spec.at} ${spec.place}, ${spec.direction}: ${spec.open ? 'open' : 'sealed'}`);
}

for (const container of SCENARIO) {
  console.log(container.number);
  handovers.registerContainer({ number: container.number, sizeTypeCode: container.sizeTypeCode });
  for (const spec of container.handovers) await record(container, spec);
}
console.log(`Done: ${dbPath}`);
