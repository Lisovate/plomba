/**
 * Muse Spark as the markings reader and the damage detector: structured output
 * (JSON schema) over a photo of the container.
 */

import { type MarkingsRead, MarkingsReadSchema } from '@plomba/contracts';
import { COMPONENT_CODES, DAMAGE_CODES } from '@plomba/core';
import { z } from 'zod';
import type {
  DamageDetector,
  DamageFinding,
  ImageInput,
  MarkingsReader,
  SizedImage,
} from '../../ports.ts';
import type { MetaClient } from './client.ts';
import { askStructured } from './structured.ts';

export interface MuseSparkOptions {
  readonly model: string;
  readonly reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
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
