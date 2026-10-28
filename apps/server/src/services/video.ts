/**
 * Augmented reality on recorded video: SAM 3.1 tracks the container through
 * every frame of a clip in one request, and the app draws the container's own
 * coordinates (CEDEX sections, earlier damage) on it frame by frame. Used for
 * walk-arounds recorded on a phone or glasses, and for simulations on a PC.
 */

import { createHash } from 'node:crypto';
import type { VideoTracking } from '@plomba/contracts';
import type { Point, Quad } from '@plomba/core';
import { ValidationError } from '../errors.ts';
import type { ResultCache, Segmenter, TrackedFrame, VideoInput } from '../ports.ts';
import { CONTAINER_CONCEPT, containerCorners } from './vision.ts';

export type StoredTracking = Omit<VideoTracking, 'cached'>;

export class VideoService {
  readonly #segmenter: Segmenter;
  readonly #cache: ResultCache<StoredTracking>;

  constructor(segmenter: Segmenter, cache: ResultCache<StoredTracking>) {
    this.#segmenter = segmenter;
    this.#cache = cache;
  }

  /** Tracks the container's face through a clip. The clip itself isn't stored. */
  async track(data: Uint8Array): Promise<VideoTracking> {
    const video: VideoInput = { data, mimeType: videoType(data) };
    const key = createHash('sha256').update(data).digest('hex');
    const cached = await this.#cache.get(key);
    if (cached) return { ...cached, cached: true };

    const tracked = await this.#segmenter.track(video, CONTAINER_CONCEPT);
    // SAM keeps object IDs stable through a clip: follow the most prominent
    // container throughout, so the overlay never jumps to its neighbour.
    const id = mostProminentObject(tracked);
    const frames = tracked.flatMap(({ frame, objects }) => {
      const corners: Quad | null = containerCorners(objects.filter((o) => o.id === id));
      return corners ? [{ frame, corners: [...corners] as [Point, Point, Point, Point] }] : [];
    });
    const result: StoredTracking = {
      frameCount: (tracked.at(-1)?.frame ?? -1) + 1,
      frames,
    };
    await this.#cache.put(key, result);
    return { ...result, cached: false };
  }
}

/** MP4 and MOV are ISO base media files: an `ftyp` box at byte 4; QuickTime has brand `qt  `. */
export function videoType(data: Uint8Array): VideoInput['mimeType'] {
  const text = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data.byteLength < 12 || text(4, 8) !== 'ftyp') {
    throw new ValidationError(
      'Upload an MP4 or MOV video (H.264 or H.265). SAM 3.1 does not read WebM.',
    );
  }
  return text(8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
}

/** The object with the largest total box area over the clip. */
function mostProminentObject(frames: readonly TrackedFrame[]): string | undefined {
  const totals = new Map<string, number>();
  for (const { objects } of frames) {
    for (const { id, box, confidence } of objects) {
      const area = (box.right - box.left) * (box.bottom - box.top) * (confidence ?? 1);
      totals.set(id, (totals.get(id) ?? 0) + area);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
