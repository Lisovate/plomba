/**
 * SAM 3.1 as the segmenter: one noun-phrase concept per request, output parsed
 * with Meta's `@meta-sam/parser`.
 */

import {
  decodeMaskToRaster,
  parseImageStream,
  type ResponsesEvent,
  recordsOfKind,
} from '@meta-sam/parser';
import { UpstreamError } from '../../errors.ts';
import type { ImageInput, SegmentedObject, Segmenter } from '../../ports.ts';
import { type MetaClient, outputText, toDataUrl } from './client.ts';

export class Sam3Segmenter implements Segmenter {
  readonly #client: MetaClient;
  readonly #model: string;

  constructor(client: MetaClient, options: { readonly model: string }) {
    this.#client = client;
    this.#model = options.model;
  }

  async segment(image: ImageInput, concept: string): Promise<SegmentedObject[]> {
    const response = await this.#client.createResponse({
      model: this.#model,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: concept },
            { type: 'input_image', image_url: toDataUrl(image) },
          ],
        },
      ],
      metadata: { include_confidence: 'true' },
    });
    return parseSegmentation(outputText(response));
  }
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
