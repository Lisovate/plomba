import { createHash } from 'node:crypto';
import type { CreateMark, FaceView, MarkingsRead } from '@plomba/contracts';
import { pino } from 'pino';
import sharp from 'sharp';
import { createTransactionRunner, openDatabase } from '../src/adapters/sqlite/database.ts';
import {
  SqliteContainerRepository,
  SqliteHandoverRepository,
  SqliteMarkRepository,
  SqlitePhotoRepository,
} from '../src/adapters/sqlite/repositories.ts';
import { createApp } from '../src/http/app.ts';
import type { SampleClips } from '../src/media/sample-clips.ts';
import type {
  Agent,
  AgentRun,
  AgentTask,
  DamageDetector,
  DamageFinding,
  DamageNoteParser,
  EventPublisher,
  FaceViewClassifier,
  ImageInput,
  MarkingsReader,
  MediaStore,
  PixelBox,
  ResultCache,
  SegmentedObject,
  Segmenter,
  SizedImage,
  SpeechTranscriber,
  SpokenDamage,
  StoredMedia,
  TrackedFrame,
  VideoInput,
} from '../src/ports.ts';
import { ClaimService } from '../src/services/claims.ts';
import { HandoverService } from '../src/services/handovers.ts';
import { IdentifyService } from '../src/services/identify.ts';
import { SpeechService } from '../src/services/speech.ts';
import { SpokenDamageService } from '../src/services/spoken-damage.ts';
import { VideoService } from '../src/services/video.ts';

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
/** A container seen corner-on: a hexagon whose near edge, at `nearX`, is taller than the outer edges. */
export function cornerObject(nearX: number): SegmentedObject {
  const [left, right, top, bottom] = [0, 400, 0, 200];
  const width = right - left;
  const height = bottom - top;
  const data = new Uint8Array(width * height);
  // Outer edges span y 30..170; the near edge spans the full 0..200.
  const edgeTop = (x: number) =>
    x <= nearX ? 30 - (30 * x) / nearX : (30 * (x - nearX)) / (width - nearX);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = edgeTop(x);
      if (y >= t && y <= height - t) data[y * width + x] = 1;
    }
  }
  return {
    id: '0',
    box: { left, top, right, bottom },
    confidence: 0.9,
    mask: { width, height, data, bounds: { left, top, right, bottom } },
  };
}

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

  /** Frames returned by `track`, as set by a test. */
  tracked: TrackedFrame[] = [];

  async track(_video: VideoInput, concept: string): Promise<TrackedFrame[]> {
    this.calls.push(`track:${concept}`);
    return this.tracked;
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

export function createTestHandoverService(options: { events?: EventPublisher } = {}) {
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
    ...(options.events ? { events: options.events } : {}),
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

/**
 * An agent that calls every tool once, then gives the scripted answers in
 * order, one per `answer()`. Records the feedback it was given.
 */
export class ScriptedAgent implements Agent {
  readonly feedback: string[] = [];
  readonly toolResults: unknown[] = [];
  tasks: AgentTask<unknown>[] = [];

  readonly answers: ((toolResults: readonly unknown[]) => unknown)[];
  readonly #callTools: boolean;

  constructor(
    answers: ((toolResults: readonly unknown[]) => unknown)[],
    options: { callTools?: boolean } = {},
  ) {
    this.answers = answers;
    this.#callTools = options.callTools ?? true;
  }

  start<T>(task: AgentTask<T>): AgentRun<T> {
    this.tasks.push(task as AgentTask<unknown>);
    const toolCalls: string[] = [];
    let turn = 0;
    return {
      toolCalls,
      correct: (feedback) => this.feedback.push(feedback),
      answer: async () => {
        if (turn === 0 && this.#callTools) {
          for (const tool of task.tools) {
            toolCalls.push(tool.name);
            this.toolResults.push(await tool.run({}));
          }
        }
        const script = this.answers[turn++];
        if (!script) throw new Error('No more scripted answers');
        return task.parser.parse(script(this.toolResults));
      },
    };
  }
}

/** An in-memory result cache. */
export class MemoryCache<T> implements ResultCache<T> {
  readonly entries = new Map<string, T>();

  async get(key: string) {
    return this.entries.get(key);
  }

  async put(key: string, value: T) {
    this.entries.set(key, value);
  }
}

/** Returns scripted spoken-damage items and records the texts it was given. */
export class FakeDamageNoteParser implements DamageNoteParser {
  readonly texts: string[] = [];
  readonly #items: readonly SpokenDamage[];

  constructor(items: readonly SpokenDamage[] = []) {
    this.#items = items;
  }

  async parse(text: string): Promise<SpokenDamage[]> {
    this.texts.push(text);
    return [...this.#items];
  }
}

/** Answers with scripted views, one per frame, and records how many frames it saw. */
export class FakeFaceViewClassifier implements FaceViewClassifier {
  readonly calls: number[] = [];
  /** The frames of the latest call, as the model would receive them. */
  frames: readonly ImageInput[] = [];
  readonly #views: readonly FaceView[];

  constructor(views: readonly FaceView[] = []) {
    this.#views = views;
  }

  async classify(frames: readonly ImageInput[]): Promise<FaceView[]> {
    this.calls.push(frames.length);
    this.frames = frames;
    return frames.map(
      (_, i) =>
        this.#views[i] ?? {
          face: null,
          squareOn: false,
          corner: null,
          doorEnd: null,
          clear: false,
          confidence: 0,
          note: 'nothing scripted',
        },
    );
  }
}

/** The HTTP app over in-memory adapters and fakes. */
export function createTestApp(
  options: {
    reader?: MarkingsReader;
    accessCode?: string;
    agent?: Agent;
    classifier?: FaceViewClassifier;
    notice?: string;
    noteParser?: DamageNoteParser;
    samples?: SampleClips;
    apiTokens?: readonly { name: string; token: string }[];
  } = {},
) {
  const context = createTestHandoverService();
  const { service, media, db, segmenter } = context;
  const speech = new SpeechService(new FakeTranscriber());
  const app = createApp({
    identify: new IdentifyService(options.reader ?? new FakeReader(null)),
    handovers: service,
    speech,
    spokenDamage: new SpokenDamageService({
      speech,
      parser: options.noteParser ?? new FakeDamageNoteParser(),
      handovers: service,
    }),
    claims: new ClaimService({
      containers: new SqliteContainerRepository(db),
      handovers: new SqliteHandoverRepository(db),
      photos: new SqlitePhotoRepository(db),
      marks: new SqliteMarkRepository(db),
      media,
      agent: options.agent ?? new ScriptedAgent([]),
    }),
    video: new VideoService({
      segmenter,
      classifier: options.classifier ?? new FakeFaceViewClassifier(),
      cache: new MemoryCache(),
    }),
    media,
    logger: silentLogger,
    accessCode: options.accessCode,
    notice: options.notice,
    samples: options.samples,
    apiTokens: options.apiTokens,
  });
  return { ...context, app };
}
