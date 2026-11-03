/**
 * Plane-to-plane mapping between a container face (metres) and a photo of it
 * (pixels). A face is flat, so four corresponding points define a homography
 * that maps every mark on the face into the photo and back.
 */

import { type Face, type FaceRect, faceSize } from './faces.ts';
import type { ContainerDimensions } from './size-type.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Four image points in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

/** A 3×3 homography in row-major order. */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export class DegenerateGeometryError extends Error {
  override name = 'DegenerateGeometryError';
}

/** Solves for the homography H with H·src[i] ∝ dst[i] (direct linear transform, h33 = 1). */
export function solveHomography(src: Quad, dst: Quad): Homography {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i] as Point;
    const { x: X, y: Y } = dst[i] as Point;
    a.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    a.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = solveLinearSystem(a, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as unknown as Homography;
}

/** Gaussian elimination with partial pivoting. Throws when the system is singular. */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = m[pivot] as number[];
    if (Math.abs(pivotRow[col] ?? 0) < 1e-12) {
      throw new DegenerateGeometryError('Points are collinear or coincide');
    }
    [m[col], m[pivot]] = [pivotRow, m[col] as number[]];
    const current = m[col] as number[];
    for (let row = col + 1; row < n; row++) {
      const target = m[row] as number[];
      const factor = (target[col] as number) / (current[col] as number);
      for (let k = col; k <= n; k++)
        target[k] = (target[k] as number) - factor * (current[k] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const r = m[row] as number[];
    let sum = r[n] as number;
    for (let k = row + 1; k < n; k++) sum -= (r[k] as number) * (x[k] as number);
    x[row] = sum / (r[row] as number);
  }
  return x;
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) throw new DegenerateGeometryError('Point maps to infinity');
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-12) throw new DegenerateGeometryError('Homography is not invertible');
  const inv = [
    (e * j - f * i) / det,
    (c * i - b * j) / det,
    (b * f - c * e) / det,
    (f * g - d * j) / det,
    (a * j - c * g) / det,
    (c * d - a * f) / det,
    (d * i - e * g) / det,
    (b * g - a * i) / det,
    (a * e - b * d) / det,
  ];
  const scale = inv[8] as number;
  return inv.map((value) => value / scale) as unknown as Homography;
}

/**
 * Picks the four corners of a roughly frontal, roughly rectangular region from
 * its pixels or outline (image coordinates, y down): the extremes of x + y and
 * x − y. Robust to ragged mask edges, but assumes the face isn't rotated by
 * more than about 45° in the photo.
 */
export function quadFromPoints(points: Iterable<Point>): Quad {
  let tl: Point | undefined;
  let tr: Point | undefined;
  let br: Point | undefined;
  let bl: Point | undefined;
  for (const p of points) {
    if (!tl || p.x + p.y < tl.x + tl.y) tl = p;
    if (!br || p.x + p.y > br.x + br.y) br = p;
    if (!tr || p.x - p.y > tr.x - tr.y) tr = p;
    if (!bl || p.x - p.y < bl.x - bl.y) bl = p;
  }
  if (!tl || !tr || !br || !bl) throw new DegenerateGeometryError('No points');
  return [tl, tr, br, bl];
}

/** Face corners in face coordinates, in the same order as a `Quad` in the photo. */
export function faceCornerQuad(face: Face, dimensions: ContainerDimensions): Quad {
  const { width, height } = faceSize(face, dimensions);
  return [
    { x: 0, y: height },
    { x: width, y: height },
    { x: width, y: 0 },
    { x: 0, y: 0 },
  ];
}

/** Homography from face coordinates (metres) to image pixels, given the face's corners in the photo. */
export function faceToImage(
  face: Face,
  dimensions: ContainerDimensions,
  imageCorners: Quad,
): Homography {
  return solveHomography(faceCornerQuad(face, dimensions), imageCorners);
}

/** The outline of a face rectangle in the photo (top-left, top-right, bottom-right, bottom-left). */
export function projectFaceRect(h: Homography, rect: FaceRect): Quad {
  return [
    applyHomography(h, { x: rect.u0, y: rect.v1 }),
    applyHomography(h, { x: rect.u1, y: rect.v1 }),
    applyHomography(h, { x: rect.u1, y: rect.v0 }),
    applyHomography(h, { x: rect.u0, y: rect.v0 }),
  ];
}

/** The axis-aligned face rectangle that contains the given image points once mapped onto the face. */
export function imagePointsToFaceRect(imageToFace: Homography, points: Iterable<Point>): FaceRect {
  let u0 = Number.POSITIVE_INFINITY;
  let v0 = Number.POSITIVE_INFINITY;
  let u1 = Number.NEGATIVE_INFINITY;
  let v1 = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const q = applyHomography(imageToFace, p);
    u0 = Math.min(u0, q.x);
    v0 = Math.min(v0, q.y);
    u1 = Math.max(u1, q.x);
    v1 = Math.max(v1, q.y);
  }
  if (!Number.isFinite(u0)) throw new DegenerateGeometryError('No points');
  return { u0, v0, u1, v1 };
}

/** The convex hull of a set of points (Andrew's monotone chain), counter-clockwise in a y-up frame. */
export function convexHull(input: Iterable<Point>): Point[] {
  const points = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
  if (points.length <= 2) return points;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower.at(-2) as Point, lower.at(-1) as Point, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of points.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2) as Point, upper.at(-1) as Point, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Shoelace area of a quadrilateral, in square pixels. */
export function quadArea(quad: Quad): number {
  let twice = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i] as Point;
    const b = quad[(i + 1) % 4] as Point;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}
