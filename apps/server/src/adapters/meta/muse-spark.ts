/**
 * Muse Spark as the markings reader: structured output (JSON schema) over a
 * photo of the container doors.
 */

import { type MarkingsRead, MarkingsReadSchema } from '@plomba/contracts';
import { z } from 'zod';
import { UpstreamError } from '../../errors.ts';
import type { ImageInput, MarkingsReader } from '../../ports.ts';
import { type MetaClient, outputText, type ResponsesRequest, toDataUrl } from './client.ts';

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

export interface MuseSparkOptions {
  readonly model: string;
  readonly reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
}

export class MuseSparkMarkingsReader implements MarkingsReader {
  readonly #client: MetaClient;
  readonly #options: MuseSparkOptions;

  constructor(client: MetaClient, options: MuseSparkOptions) {
    this.#client = client;
    this.#options = options;
  }

  async read(image: ImageInput): Promise<MarkingsRead> {
    return this.#structured(
      {
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
    const answer = await this.#structured(
      {
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

  async #structured<T>(
    call: {
      instructions: string;
      prompt: string;
      image: ImageInput;
      schemaName: string;
      schema: Record<string, unknown>;
    },
    parser: z.ZodType<T>,
  ): Promise<T> {
    const request: ResponsesRequest = {
      model: this.#options.model,
      instructions: call.instructions,
      reasoning: { effort: this.#options.reasoningEffort },
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: call.prompt },
            { type: 'input_image', image_url: toDataUrl(call.image) },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', name: call.schemaName, schema: call.schema, strict: true },
      },
    };
    const response = await this.#client.createResponse(request);
    const text = outputText(response);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new UpstreamError('Muse Spark returned text that is not JSON', { cause });
    }
    const parsed = parser.safeParse(json);
    if (!parsed.success) {
      throw new UpstreamError('Muse Spark returned JSON that does not match the schema', {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}
