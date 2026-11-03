/**
 * Uses of segmentation that don't depend on the handover: finding a face's
 * corners in a photo, and finding what must be blurred.
 */

import {
  type CornerSplit,
  convexHull,
  DegenerateGeometryError,
  type Point,
  type Quad,
  quadArea,
  quadFromPoints,
  splitCornerView,
} from '@plomba/core';
import type { ImageInput, PixelBox, SegmentedObject, Segmenter } from '../ports.ts';

/** The concept that outlines the container. Tested against the alternatives in docs/build-log.md. */
export const CONTAINER_CONCEPT = 'shipping container';

/**
 * What is blurred before a photo is stored. `face` finds faces `human face`
 * misses, e.g. a driver behind a windscreen (docs/evaluation.md).
 */
export const PRIVACY_CONCEPTS = ['face', 'license plate'] as const;

/** A detected face outline must cover at least this share of the photo to be trusted. */
const MIN_FACE_AREA_SHARE = 0.05;

/**
 * The leftmost and rightmost mask pixel of every row, in photo pixels. Every
 * vertex of the mask's convex hull is among them, so they're enough for
 * outlines and corner detection at a fraction of the pixels.
 */
export function maskBoundary(object: SegmentedObject): Point[] {
  const { width, height, data, bounds } = object.mask;
  const sx = (bounds.right - bounds.left) / width;
  const sy = (bounds.bottom - bounds.top) / height;
  const points: Point[] = [];
  for (let row = 0; row < height; row++) {
    let first = -1;
    let last = -1;
    for (let col = 0; col < width; col++) {
      if (data[row * width + col]) {
        if (first < 0) first = col;
        last = col;
      }
    }
    if (first < 0) continue;
    const y = bounds.top + (row + 0.5) * sy;
    points.push({ x: bounds.left + first * sx, y }, { x: bounds.left + (last + 1) * sx, y });
  }
  return points;
}

function maskArea(object: SegmentedObject): number {
  const { width, height, data, bounds } = object.mask;
  let count = 0;
  for (const value of data) count += value ? 1 : 0;
  return (count * (bounds.right - bounds.left) * (bounds.bottom - bounds.top)) / (width * height);
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
  const quad = containerCorners(await segmenter.segment(image, CONTAINER_CONCEPT));
  return quad && quadArea(quad) >= MIN_FACE_AREA_SHARE * image.width * image.height ? quad : null;
}

/** The corners of the most prominent container among the objects SAM found. */
export function containerCorners(objects: readonly SegmentedObject[]): Quad | null {
  return containerOutline(objects)?.corners ?? null;
}

/**
 * The most prominent container's outer corners and, when it's seen
 * corner-on, its two faces (see `splitCornerView`).
 */
export function containerOutline(
  objects: readonly SegmentedObject[],
): { corners: Quad; split: CornerSplit | null } | null {
  let best: { object: SegmentedObject; score: number } | undefined;
  for (const object of objects) {
    const score = maskArea(object) * (object.confidence ?? 1);
    if (!best || score > best.score) best = { object, score };
  }
  if (!best) return null;
  const boundary = maskBoundary(best.object);
  try {
    const corners = quadFromPoints(boundary);
    return { corners, split: splitCornerView(convexHull(boundary), corners) };
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
