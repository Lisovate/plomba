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
 *     --clips ~/.local/share/plomba-demo-videos/clips
 *
 * Needs ffmpeg to cut frames. Refuses a data directory that already has data.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pino } from 'pino';
import { MetaClient } from '../src/adapters/meta/client.ts';
import { MuseSparkDamageDetector } from '../src/adapters/meta/muse-spark.ts';
import { Sam3Segmenter } from '../src/adapters/meta/sam.ts';
import { createTransactionRunner, openDatabase } from '../src/adapters/sqlite/database.ts';
import {
  SqliteContainerRepository,
  SqliteHandoverRepository,
  SqliteMarkRepository,
  SqlitePhotoRepository,
} from '../src/adapters/sqlite/repositories.ts';
import { loadConfig } from '../src/config.ts';
import { FileMediaStore } from '../src/media/file-media-store.ts';
import { HandoverService } from '../src/services/handovers.ts';
import { type ContainerSpec, type HandoverSpec, SCENARIO } from './demo/scenario.ts';

const { values } = parseArgs({
  options: { clips: { type: 'string' } },
});
const clipsDir = values.clips;
if (!clipsDir) throw new Error('Pass --clips <folder with the scenario clips>');

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
const handovers = new HandoverService({
  containers: new SqliteContainerRepository(db),
  handovers: new SqliteHandoverRepository(db),
  photos: new SqlitePhotoRepository(db),
  marks: new SqliteMarkRepository(db),
  media: new FileMediaStore(join(config.dataDir, 'media')),
  segmenter: new Sam3Segmenter(meta, { model: config.meta.segmentationModel }),
  detector: new MuseSparkDamageDetector(vision, {
    model: config.meta.visionModel,
    reasoningEffort: config.meta.reasoningEffort,
    api: config.meta.vision.apiStyle,
  }),
  transaction: createTransactionRunner(db),
  clock,
  newId: randomUUID,
  ediSenderId: config.ediSenderId,
});

/** One frame of a clip as a JPEG. */
function frame(clip: string, at: number): Uint8Array {
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(at), '-i', join(clipsDir as string, clip)].concat([
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
    throw new Error(`ffmpeg could not cut ${clip} at ${at}s: ${result.stderr.toString()}`);
  }
  return new Uint8Array(result.stdout);
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
      data: frame(photoSpec.frame.clip, photoSpec.frame.at),
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
