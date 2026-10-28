/**
 * SAM 3.1 as the segmenter: one noun-phrase concept per request, output parsed
 * with Meta's `@meta-sam/parser`.
 */

import {
  buildObjectPrompt,
  decodeMaskToRaster,
  frameIndexOf,
  parseImageStream,
  parseVideoStream,
  type ResponsesEvent,
  recordsOfKind,
  type SegmentationRecord,
} from '@meta-sam/parser';
import { UpstreamError } from '../../errors.ts';
import type {
  ImageInput,
  PixelBox,
  SegmentedObject,
  Segmenter,
  SizedImage,
  TrackedFrame,
  VideoInput,
} from '../../ports.ts';
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

  /** Uploads the clip through the Files API and tracks the concept through every frame. */
  async track(video: VideoInput, concept: string): Promise<TrackedFrame[]> {
    const extension = video.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    const fileId = await this.#client.uploadFile(video.data, `clip.${extension}`, video.mimeType);
    const response = await this.#client.createResponse(
      {
        model: this.#model,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: concept },
              { type: 'input_video', file_id: fileId },
            ],
          },
        ],
        // One-bit masks are several times smaller; outlines don't need more.
        metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
      },
      { timeoutMs: VIDEO_TIMEOUT_MS },
    );
    return parseVideoSegmentation(outputText(response));
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

/** Video segmentation can take minutes on long clips. */
const VIDEO_TIMEOUT_MS = 10 * 60 * 1000;

/** Replays a complete output text as the event stream the parser reads. */
async function* asEvents(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: 'output', output_index: 0, content_index: 0 } as const;
  yield { type: 'response.output_text.delta', delta: text, ...lane };
  yield { type: 'response.output_text.done', text, ...lane };
  yield { type: 'response.completed' };
}

function throwOnErrors(result: { diagnostics: readonly { severity: string; message: string }[] }) {
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    throw new UpstreamError(`SAM output could not be parsed: ${errors[0]?.message}`);
  }
}

/** Parses SAM image output text into objects with decoded masks. */
export async function parseSegmentation(text: string): Promise<SegmentedObject[]> {
  if (text.trim() === '') return [];
  const result = await parseImageStream(asEvents(text)).finalResult;
  throwOnErrors(result);
  return toObjects(result.records);
}

/** Parses SAM video output text into the objects of each frame, in frame order. */
export async function parseVideoSegmentation(text: string): Promise<TrackedFrame[]> {
  if (text.trim() === '') return [];
  const result = await parseVideoStream(asEvents(text)).finalResult;
  throwOnErrors(result);
  const byFrame = new Map<number, SegmentationRecord[]>();
  for (const record of result.records) {
    if (record.kind === 'text') continue;
    const frame = frameIndexOf(record) ?? 0;
    byFrame.set(frame, [...(byFrame.get(frame) ?? []), record]);
  }
  return [...byFrame.entries()]
    .sort(([a], [b]) => a - b)
    .map(([frame, records]) => ({ frame, objects: toObjects(records) }));
}

function toObjects(records: readonly SegmentationRecord[]): SegmentedObject[] {
  const boxes = new Map(recordsOfKind(records, 'box').map((b) => [b.objectId, b]));
  return recordsOfKind(records, 'mask').map((record) => {
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
