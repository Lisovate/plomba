import { createHash } from 'node:crypto';
import type { CreateMark, MarkingsRead } from '@plomba/contracts';
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
  DamageDetector,
  DamageFinding,
  ImageInput,
  MarkingsReader,
  MediaStore,
  PixelBox,
  SegmentedObject,
  Segmenter,
  SizedImage,
  SpeechTranscriber,
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
    id: '0',
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
  /** When set, `refine` outlines each box as a filled rectangle; otherwise finds nothing. */
  outlineBoxes = true;

  async segment(_image: ImageInput, concept: string): Promise<SegmentedObject[]> {
    this.calls.push(concept);
    return this.responses.get(concept) ?? [];
  }

  async refine(_image: SizedImage, boxes: readonly PixelBox[]) {
    this.calls.push(`refine:${boxes.length}`);
    return boxes.map((b, i) =>
      this.outlineBoxes
        ? {
            ...rectangleObject(
              Math.round(b.left),
              Math.round(b.top),
              Math.round(b.right),
              Math.round(b.bottom),
              0.8,
            ),
            id: String(i + 1),
          }
        : null,
    );
  }
}

export class FakeDetector implements DamageDetector {
  findings: DamageFinding[] = [];

  async detect(_image: SizedImage): Promise<DamageFinding[]> {
    return this.findings;
  }
}

/** A confirmed new mark with no codes; override what a test cares about. */
export function markInput(overrides: Partial<CreateMark> = {}): CreateMark {
  return {
    face: 'R',
    rect: { u0: 0, v0: 0, u1: 1, v1: 1 },
    outline: null,
    damageCode: null,
    componentCode: null,
    status: 'new',
    source: 'confirmed',
    previousMarkId: null,
    photoId: null,
    note: null,
    ...overrides,
  };
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
  const detector = new FakeDetector();
  const media = new MemoryMediaStore();
  const service = new HandoverService({
    containers: new SqliteContainerRepository(db),
    handovers: new SqliteHandoverRepository(db),
    photos: new SqlitePhotoRepository(db),
    marks: new SqliteMarkRepository(db),
    media,
    segmenter,
    detector,
    transaction: createTransactionRunner(db),
    clock: fixedClock(),
    newId: sequentialIds(),
    ediSenderId: 'PLOMBA-TEST',
  });
  return { db, segmenter, detector, media, service };
}

/** A WAV file of silence: mono, 16-bit PCM. */
export function makeWav(
  options: { sampleRate?: number; channels?: number; bits?: number; ms?: number } = {},
): Uint8Array {
  const { sampleRate = 16_000, channels = 1, bits = 16, ms = 1000 } = options;
  const dataBytes = Math.round((sampleRate * channels * (bits / 8) * ms) / 1000);
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

export class FakeTranscriber implements SpeechTranscriber {
  calls = 0;

  async transcribe(audio: Uint8Array) {
    this.calls++;
    return { text: 'wgniecenie przy drzwiach', durationMs: audio.byteLength > 44 ? 1000 : 0 };
  }
}
