/**
 * Uses of segmentation that don't depend on the handover: finding a face's
 * corners in a photo, and finding what must be blurred.
 */

import { DegenerateGeometryError, type Point, type Quad, quadFromPoints } from '@plomba/core';
import type { ImageInput, PixelBox, SegmentedObject, Segmenter } from '../ports.ts';

/** The concept that outlines the container. Tested against the alternatives in docs/build-log.md. */
export const CONTAINER_CONCEPT = 'shipping container';

/** What is blurred before a photo is stored. */
export const PRIVACY_CONCEPTS = ['human face', 'license plate'] as const;

/** A detected face outline must cover at least this share of the photo to be trusted. */
const MIN_FACE_AREA_SHARE = 0.05;

/** Image pixels covered by a mask, mapped from mask resolution to the photo. */
export function* maskPoints(object: SegmentedObject): Generator<Point> {
  const { width, height, data, bounds } = object.mask;
  const sx = (bounds.right - bounds.left) / width;
  const sy = (bounds.bottom - bounds.top) / height;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (data[row * width + col]) {
        yield { x: bounds.left + (col + 0.5) * sx, y: bounds.top + (row + 0.5) * sy };
      }
    }
  }
}

function maskArea(object: SegmentedObject): number {
  const { width, height, data, bounds } = object.mask;
  let count = 0;
  for (const value of data) count += value ? 1 : 0;
  return (count * (bounds.right - bounds.left) * (bounds.bottom - bounds.top)) / (width * height);
}

/** Shoelace area of a quadrilateral. */
export function quadArea(quad: Quad): number {
  let twice = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i] as Point;
    const b = quad[(i + 1) % 4] as Point;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Finds the corners of the container face that fills a roughly head-on photo.
 * Returns `null` when nothing convincing is found; the checker then places the
 * corners by hand.
 */
export async function detectFaceCorners(
  segmenter: Segmenter,
  image: ImageInput & { readonly width: number; readonly height: number },
): Promise<Quad | null> {
  const objects = await segmenter.segment(image, CONTAINER_CONCEPT);
  let best: { object: SegmentedObject; score: number } | undefined;
  for (const object of objects) {
    const score = maskArea(object) * (object.confidence ?? 1);
    if (!best || score > best.score) best = { object, score };
  }
  if (!best) return null;
  try {
    const quad = quadFromPoints(maskPoints(best.object));
    return quadArea(quad) >= MIN_FACE_AREA_SHARE * image.width * image.height ? quad : null;
  } catch (error) {
    if (error instanceof DegenerateGeometryError) return null;
    throw error;
  }
}

/** Every region that must be blurred: all faces and number plates, at any confidence. */
export async function findPrivacyRegions(
  segmenter: Segmenter,
  image: ImageInput,
): Promise<PixelBox[]> {
  const results = await Promise.all(PRIVACY_CONCEPTS.map((c) => segmenter.segment(image, c)));
  return results.flat().map((object) => object.box);
}
