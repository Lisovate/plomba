/**
 * SAM 3.1 as the segmenter: one noun-phrase concept per request, output parsed
 * with Meta's `@meta-sam/parser`.
 */

import {
  buildObjectPrompt,
  decodeMaskToRaster,
  parseImageStream,
  type ResponsesEvent,
  recordsOfKind,
} from '@meta-sam/parser';
import { UpstreamError } from '../../errors.ts';
import type { ImageInput, PixelBox, SegmentedObject, Segmenter, SizedImage } from '../../ports.ts';
import { type MetaClient, outputText, toDataUrl } from './client.ts';

export class Sam3Segmenter implements Segmenter {
  readonly #client: MetaClient;
  readonly #model: string;

  constructor(client: MetaClient, options: { readonly model: string }) {
    this.#client = client;
    this.#model = options.model;
  }

  async segment(image: ImageInput, concept: string): Promise<SegmentedObject[]> {
    return this.#request(image, concept);
  }

  /** One request with a box prompt per object; SAM reports each under its prompt's ID. */
  async refine(image: SizedImage, boxes: readonly PixelBox[]): Promise<(SegmentedObject | null)[]> {
    if (boxes.length === 0) return [];
    const size = { width: image.width, height: image.height };
    const prompt = buildObjectPrompt({
      size,
      objects: boxes.map((box, index) => ({
        id: index + 1,
        prompts: [{ box: toPromptBox(box, size) }],
      })),
    });
    const objects = await this.#request(image, prompt);
    return boxes.map((_, index) => objects.find((o) => o.id === String(index + 1)) ?? null);
  }

  async #request(image: ImageInput, text: string): Promise<SegmentedObject[]> {
    const response = await this.#client.createResponse({
      model: this.#model,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text },
            { type: 'input_image', image_url: toDataUrl(image) },
          ],
        },
      ],
      metadata: { include_confidence: 'true' },
    });
    return parseSegmentation(outputText(response));
  }
}

/** Integer, half-open and inside the image, as `buildObjectPrompt` requires. */
function toPromptBox(box: PixelBox, size: { width: number; height: number }) {
  const left = Math.max(0, Math.min(size.width - 1, Math.floor(box.left)));
  const top = Math.max(0, Math.min(size.height - 1, Math.floor(box.top)));
  return {
    left,
    top,
    right: Math.max(left + 1, Math.min(size.width, Math.ceil(box.right))),
    bottom: Math.max(top + 1, Math.min(size.height, Math.ceil(box.bottom))),
  };
}

/** Parses SAM image output text into objects with decoded masks. */
export async function parseSegmentation(text: string): Promise<SegmentedObject[]> {
  if (text.trim() === '') return [];
  const lane = { item_id: 'output', output_index: 0, content_index: 0 } as const;
  async function* events(): AsyncIterable<ResponsesEvent> {
    yield { type: 'response.output_text.delta', delta: text, ...lane };
    yield { type: 'response.output_text.done', text, ...lane };
    yield { type: 'response.completed' };
  }

  const result = await parseImageStream(events()).finalResult;
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    throw new UpstreamError(`SAM output could not be parsed: ${errors[0]?.message}`);
  }

  const boxes = new Map(recordsOfKind(result.records, 'box').map((b) => [b.objectId, b]));
  return recordsOfKind(result.records, 'mask').map((record) => {
    const box = boxes.get(record.objectId);
    return {
      id: record.objectId,
      box: box
        ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
        : record.bounds,
      confidence: record.confidence ?? box?.confidence,
      mask: {
        width: record.mask.width,
        height: record.mask.height,
        data: decodeMaskToRaster(record.mask),
        bounds: record.bounds,
      },
    };
  });
}
