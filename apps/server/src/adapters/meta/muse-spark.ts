/**
 * Muse Spark as the markings reader and the damage detector: structured output
 * (JSON schema) over a photo of the container.
 */

import {
  type FaceView,
  FaceViewSchema,
  type MarkingsRead,
  MarkingsReadSchema,
} from '@plomba/contracts';
import {
  COMPONENT_CODES,
  type ContainerDimensions,
  DAMAGE_CODES,
  FACE_NAMES,
  FACES,
  type Face,
  longSectionCount,
} from '@plomba/core';
import { z } from 'zod';
import type {
  DamageDetector,
  DamageFinding,
  DamageNoteParser,
  FaceViewClassifier,
  ImageInput,
  MarkingsReader,
  SizedImage,
  SpokenDamage,
} from '../../ports.ts';
import type { MetaClient } from './client.ts';
import { type ApiStyle, askStructured } from './structured.ts';

export interface MuseSparkOptions {
  readonly model: string;
  readonly reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
  /** Defaults to the Responses API. */
  readonly api?: ApiStyle;
}

// Markings ------------------------------------------------------------------

const READ_INSTRUCTIONS = `You read the identification markings on intermodal shipping containers during a handover inspection.

Report only what is painted and legible in the photo:
- containerNumber: the ISO 6346 number, 11 characters without spaces: 3-letter owner code, category letter (U, J or Z), 6-digit serial, 1 check digit (often boxed). null if it isn't visible.
- sizeTypeCode: the 4-character ISO size and type code (e.g. 22G1, 42G1, 45G1, L5G1), usually painted below the number. null if not visible.
- sealNumbers: numbers on seals attached to the door locking bars.
- hazardClasses: IMO hazard class numbers on any dangerous goods placards (e.g. "3", "2.1").
- notes: one or two sentences on legibility (worn paint, glare, partly hidden characters).

Transcribe each character as it appears. Do not change characters to make the check digit work: a separate step verifies the number and repairs misreads.`;

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['containerNumber', 'sizeTypeCode', 'sealNumbers', 'hazardClasses', 'notes'],
  properties: {
    containerNumber: { type: ['string', 'null'] },
    sizeTypeCode: { type: ['string', 'null'] },
    sealNumbers: { type: 'array', items: { type: 'string' } },
    hazardClasses: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
} as const;

const CHOOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['choice', 'reason'],
  properties: {
    choice: {
      type: ['integer', 'null'],
      description: '1-based index of the matching candidate, or null if none clearly matches',
    },
    reason: { type: 'string' },
  },
} as const;

const ChoiceSchema = z.object({ choice: z.number().int().nullable(), reason: z.string() });

export class MuseSparkMarkingsReader implements MarkingsReader {
  readonly #client: MetaClient;
  readonly #options: MuseSparkOptions;

  constructor(client: MetaClient, options: MuseSparkOptions) {
    this.#client = client;
    this.#options = options;
  }

  async read(image: ImageInput): Promise<MarkingsRead> {
    return askStructured(
      this.#client,
      {
        ...this.#options,
        instructions: READ_INSTRUCTIONS,
        prompt: 'Read the container markings in this photo.',
        image,
        schemaName: 'container_markings',
        schema: READ_SCHEMA,
      },
      MarkingsReadSchema,
    );
  }

  async chooseNumber(
    image: ImageInput,
    candidates: readonly string[],
  ): Promise<{ choice: string | null; reason: string }> {
    const list = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const answer = await askStructured(
      this.#client,
      {
        ...this.#options,
        instructions: READ_INSTRUCTIONS,
        prompt: `The container number read from this photo failed its ISO 6346 check digit. Each candidate below passes the check digit and differs from the read only in look-alike characters:\n${list}\n\nCompare every character of each candidate with the painted number. Choose the candidate that matches the photo, or null if the photo doesn't clearly show which one it is.`,
        image,
        schemaName: 'container_number_choice',
        schema: CHOOSE_SCHEMA,
      },
      ChoiceSchema,
    );
    const choice =
      answer.choice !== null && answer.choice >= 1 && answer.choice <= candidates.length
        ? (candidates[answer.choice - 1] ?? null)
        : null;
    return { choice, reason: answer.reason };
  }
}

// Damage --------------------------------------------------------------------

const DAMAGE_INSTRUCTIONS = `You inspect the exterior of an intermodal shipping container at a handover, for an equipment interchange receipt.

Find every visible damage on the container: dents, holes, cuts, cracks, bent, bowed, broken or missing parts, heavy corrosion. Ignore dirt, stains, shadows, labels, stencilled markings, normal wear, and anything that is not part of the container.

For each damage give:
- box: a tight box [x0, y0, x1, y1] around it, on a 0–1000 scale of the image width and height;
- damageCode and componentCode: ISO 9897 (CEDEX) codes;
- description: a few words a checker would write;
- confidence: 0–1 that this is real damage, not a stain, shadow or marking.

Return an empty list if there is no damage.`;

const DAMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['box', 'damageCode', 'componentCode', 'description', 'confidence'],
        properties: {
          box: { type: 'array', items: { type: 'integer' } },
          damageCode: { type: 'string', enum: Object.keys(DAMAGE_CODES) },
          componentCode: {
            type: ['string', 'null'],
            enum: [...Object.keys(COMPONENT_CODES), null],
          },
          description: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

const FindingsSchema = z.object({
  findings: z.array(
    z.object({
      box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      damageCode: z.enum(Object.keys(DAMAGE_CODES) as [keyof typeof DAMAGE_CODES]),
      componentCode: z
        .enum(Object.keys(COMPONENT_CODES) as [keyof typeof COMPONENT_CODES])
        .nullable(),
      description: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export class MuseSparkDamageDetector implements DamageDetector {
  readonly #client: MetaClient;
  readonly #options: MuseSparkOptions;

  constructor(client: MetaClient, options: MuseSparkOptions) {
    this.#client = client;
    this.#options = options;
  }

  async detect(image: SizedImage): Promise<DamageFinding[]> {
    const { findings } = await askStructured(
      this.#client,
      {
        ...this.#options,
        instructions: DAMAGE_INSTRUCTIONS,
        prompt: 'List the damage visible on this container.',
        image,
        schemaName: 'container_damage',
        schema: DAMAGE_SCHEMA,
      },
      FindingsSchema,
    );
    const toX = (v: number) => clamp((v * image.width) / 1000, 0, image.width);
    const toY = (v: number) => clamp((v * image.height) / 1000, 0, image.height);
    return findings
      .map(({ box: [x0, y0, x1, y1], ...finding }) => ({
        ...finding,
        box: {
          left: toX(Math.min(x0, x1)),
          top: toY(Math.min(y0, y1)),
          right: toX(Math.max(x0, x1)),
          bottom: toY(Math.max(y0, y1)),
        },
      }))
      .filter((f) => f.box.right - f.box.left >= 2 && f.box.bottom - f.box.top >= 2);
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Faces in a walk-around ----------------------------------------------------

const VIEW_INSTRUCTIONS = `You look at frames from a video of a checker walking around one intermodal shipping container at a handover. The frames are in the order they were filmed.

For each frame, say which face of the container is in view square-on:
- D: the door end. Two doors with vertical locking bars, handles and hinges; the container number is painted on the doors.
- F: the front end, opposite the doors. A plain corrugated wall without doors.
- L or R: a long side. Left and right are as seen standing at the door end looking towards the front. So when you face a side from outside: if the door end is at the right of the frame, it is the left side (L); if the door end is at the left of the frame, it is the right side (R).
- T: the roof, seen from above.
- null: no single face is in view square-on, e.g. a corner with two faces at similar angles, a close-up of part of a face, or no container.

When a side's ends aren't visible in its own frame, use other clues:
- The frames come from one continuous walk, so the faces follow each other around the container: the doors, one side, the front, the other side. A side reached by walking from the doors, with the doors on the left of the frame, is R.
- On a truck, trailer or rail wagon, containers are normally loaded with the doors at the rear, away from the cab or locomotive.

For each frame give:
- frame: its 1-based position in the list;
- face: D, F, L, R, T or null;
- squareOn: true when the whole face is in view and seen roughly square-on, not at a steep angle;
- corner: when the frame shows two faces meeting at a vertical edge of the container, both wholly in view, the face left of that edge and the face right of it; otherwise null. Seen from outside, the face on the right always follows the one on the left going round the container: (D, R), (R, F), (F, L) or (L, D). So doors left of the edge means the right side (R) is on the right;
- clear: false when the image is blurred, or when anything in the foreground overlaps the container in the image, however small: a finger, hand, person, vehicle or pole. True only when the face is sharp and unobstructed;
- confidence: 0–1 for the face;
- note: a few words on what is in view.`;

const VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['views'],
  properties: {
    views: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['frame', 'face', 'squareOn', 'corner', 'clear', 'confidence', 'note'],
        properties: {
          frame: { type: 'integer' },
          face: { type: ['string', 'null'], enum: [...FACES, null] },
          squareOn: { type: 'boolean' },
          corner: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['left', 'right'],
            properties: {
              left: { type: 'string', enum: [...FACES] },
              right: { type: 'string', enum: [...FACES] },
            },
          },
          clear: { type: 'boolean' },
          confidence: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

const ViewsAnswerSchema = z.object({
  views: z.array(FaceViewSchema.extend({ frame: z.number().int() })),
});

export class MuseSparkFaceViewClassifier implements FaceViewClassifier {
  readonly #client: MetaClient;
  readonly #options: MuseSparkOptions;
  readonly #maxImages: number;

  /**
   * `maxImages`: images the endpoint accepts per request. Muse Spark Open on
   * Baseten refuses more than 8 ("Too many images: 12 (max 8)"); runs split
   * there lose sight of each other, so one call is preferred wherever it fits.
   */
  constructor(client: MetaClient, options: MuseSparkOptions & { readonly maxImages: number }) {
    const { maxImages, ...rest } = options;
    this.#client = client;
    this.#options = rest;
    this.#maxImages = maxImages;
  }

  /**
   * Frames go in as few calls as the image limit allows, in balanced runs of
   * consecutive frames, so each call still sees part of the walk in order.
   */
  async classify(frames: readonly ImageInput[]): Promise<FaceView[]> {
    const calls = Math.ceil(frames.length / this.#maxImages);
    const size = Math.ceil(frames.length / Math.max(1, calls));
    const runs = Array.from({ length: calls }, (_, i) => frames.slice(i * size, (i + 1) * size));
    return (await Promise.all(runs.map((run) => this.#classifyRun(run)))).flat();
  }

  async #classifyRun(frames: readonly ImageInput[]): Promise<FaceView[]> {
    const { views } = await askStructured(
      this.#client,
      {
        ...this.#options,
        instructions: VIEW_INSTRUCTIONS,
        prompt: `Here are ${frames.length} frames of the walk-around, in order. Name the face in each.`,
        image: frames,
        schemaName: 'walkaround_faces',
        schema: VIEW_SCHEMA,
      },
      ViewsAnswerSchema,
    );
    // Align by the model's own frame numbers; a frame it skipped shows no face.
    const byFrame = new Map(views.map(({ frame, ...view }) => [frame, view]));
    return frames.map(
      (_, i) =>
        byFrame.get(i + 1) ?? {
          face: null,
          squareOn: false,
          corner: null,
          clear: false,
          confidence: 0,
          note: 'Not answered',
        },
    );
  }
}

// Damage described aloud -----------------------------------------------------

function noteInstructions(face: Face, dimensions: ContainerDimensions): string {
  const sections = longSectionCount(dimensions);
  return `You turn a container checker's spoken note into damage items for an equipment interchange receipt, coded to ISO 9897 (CEDEX). The note is in Polish or English and comes from speech recognition, so words can be misheard.

The checker is at the ${FACE_NAMES[face].toLowerCase()} (${face}) of a ${sections === 10 ? 40 : 20} ft container. Faces: D door end; F front end, opposite the doors; L left side and R right side, as seen from the door end looking towards the front; T roof.

Sections, as in CEDEX location codes:
- sides and roof: 1 to ${sections}, counted from the door end;
- door end and front end: 1 to 4, left to right as seen from the door end (1 and 4 are the corner posts).
Halves: upper or lower on the sides and ends; left or right on the roof.

For each damage the checker describes, give:
- face: the face they name, or ${face} if they don't name one;
- location: the sections they name as from and to (one section: from = to), and the half (null if they don't say one or mean the full height); null if they don't say where at all;
- damageCode and componentCode: CEDEX codes; componentCode null if unclear. Polish words: wgniecenie DT, dziura or otwór HO, rdza or korozja CO, wygięty BT, pęknięty CK, rozcięty CU, złamany BR, brak MS; panel or poszycie PAA, szyna or rama RLA, słupek narożny CPS, naroże CFG;
- note: a short description in the checker's own words and language, with any size they give.

Ignore anything that isn't about damage. Return no items if no damage is described.`;
}

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['face', 'location', 'damageCode', 'componentCode', 'note'],
        properties: {
          face: { type: 'string', enum: [...FACES] },
          location: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['from', 'to', 'half'],
            properties: {
              from: { type: 'integer' },
              to: { type: 'integer' },
              half: { type: ['string', 'null'], enum: ['upper', 'lower', 'left', 'right', null] },
            },
          },
          damageCode: { type: 'string', enum: Object.keys(DAMAGE_CODES) },
          componentCode: {
            type: ['string', 'null'],
            enum: [...Object.keys(COMPONENT_CODES), null],
          },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

const NoteItemsSchema = z.object({
  items: z.array(
    z.object({
      face: z.enum(FACES),
      location: z
        .object({
          from: z.number().int(),
          to: z.number().int(),
          half: z.enum(['upper', 'lower', 'left', 'right']).nullable(),
        })
        .nullable(),
      damageCode: z.enum(Object.keys(DAMAGE_CODES) as [keyof typeof DAMAGE_CODES]),
      componentCode: z
        .enum(Object.keys(COMPONENT_CODES) as [keyof typeof COMPONENT_CODES])
        .nullable(),
      note: z.string(),
    }),
  ),
});

export class MuseSparkDamageNoteParser implements DamageNoteParser {
  readonly #client: MetaClient;
  readonly #options: MuseSparkOptions;

  constructor(client: MetaClient, options: MuseSparkOptions) {
    this.#client = client;
    this.#options = options;
  }

  async parse(
    text: string,
    context: { readonly face: Face; readonly dimensions: ContainerDimensions },
  ): Promise<SpokenDamage[]> {
    const { items } = await askStructured(
      this.#client,
      {
        ...this.#options,
        instructions: noteInstructions(context.face, context.dimensions),
        prompt: `The checker said: """${text}"""`,
        schemaName: 'spoken_damage',
        schema: NOTE_SCHEMA,
      },
      NoteItemsSchema,
    );
    return items;
  }
}
