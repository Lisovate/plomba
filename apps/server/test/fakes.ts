import { createHash } from 'node:crypto';
import type { MarkingsRead } from '@plomba/contracts';
import { pino } from 'pino';
import sharp from 'sharp';
import { createTransactionRunner, openDatabase } from '../src/adapters/sqlite/database.ts';
import {
  SqliteContainerRepository,
  SqliteHandoverRepository,
  SqliteMarkRepository,
  SqlitePhotoRepository,
} from '../src/adapters/sqlite/repositories.ts';
import type {
  ImageInput,
  MarkingsReader,
  MediaStore,
  SegmentedObject,
  Segmenter,
  StoredMedia,
} from '../src/ports.ts';
import { HandoverService } from '../src/services/handovers.ts';

export const silentLogger = pino({ level: 'silent' });

/** A solid-colour JPEG of the given size. */
export async function makePhoto(width = 400, height = 300): Promise<Uint8Array> {
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 40, b: 30 } },
  })
    .jpeg()
    .toBuffer();
  return new Uint8Array(data);
}

export function sequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

export function fixedClock(start = Date.parse('2026-10-28T08:00:00Z')) {
  let t = start;
  return {
    now: () => {
      t += 1000;
      return new Date(t);
    },
  };
}

export class FakeReader implements MarkingsReader {
  readonly reads: MarkingsRead[] = [];
  choice: string | null = null;
  chooseCalls: string[][] = [];

  constructor(containerNumber: string | null) {
    this.reads.push({
      containerNumber,
      sizeTypeCode: '42G1',
      sealNumbers: [],
      hazardClasses: [],
      notes: '',
    });
  }

  async read(_image: ImageInput): Promise<MarkingsRead> {
    return this.reads[0] as MarkingsRead;
  }

  async chooseNumber(_image: ImageInput, candidates: readonly string[]) {
    this.chooseCalls.push([...candidates]);
    return { choice: this.choice, reason: 'The third character has a gap on the right.' };
  }
}

/** A filled rectangle mask, at the photo's resolution. */
export function rectangleObject(
  left: number,
  top: number,
  right: number,
  bottom: number,
  confidence = 0.9,
): SegmentedObject {
  const width = right - left;
  const height = bottom - top;
  return {
    box: { left, top, right, bottom },
    confidence,
    mask: {
      width,
      height,
      data: new Uint8Array(width * height).fill(1),
      bounds: { left, top, right, bottom },
    },
  };
}

export class FakeSegmenter implements Segmenter {
  readonly calls: string[] = [];
  readonly responses = new Map<string, SegmentedObject[]>();

  async segment(_image: ImageInput, concept: string): Promise<SegmentedObject[]> {
    this.calls.push(concept);
    return this.responses.get(concept) ?? [];
  }
}

export class MemoryMediaStore implements MediaStore {
  readonly files = new Map<string, Uint8Array>();

  async put(data: Uint8Array): Promise<StoredMedia> {
    const sha256 = createHash('sha256').update(data).digest('hex');
    this.files.set(sha256, data);
    return { sha256, size: data.byteLength };
  }

  async get(sha256: string): Promise<Uint8Array | undefined> {
    return this.files.get(sha256);
  }
}

export function createTestHandoverService() {
  const db = openDatabase(':memory:');
  const segmenter = new FakeSegmenter();
  const media = new MemoryMediaStore();
  const service = new HandoverService({
    containers: new SqliteContainerRepository(db),
    handovers: new SqliteHandoverRepository(db),
    photos: new SqlitePhotoRepository(db),
    marks: new SqliteMarkRepository(db),
    media,
    segmenter,
    transaction: createTransactionRunner(db),
    clock: fixedClock(),
    newId: sequentialIds(),
  });
  return { db, segmenter, media, service };
}
