/**
 * Turning a recorded walk-around into face photos. The container's outline is
 * tracked through every frame of the clip; these functions choose the frames
 * worth looking at (one face, whole, large and square-on), and then the best
 * frame of each face once a model has named the faces.
 */

import type { Face } from './faces.ts';
import type { Point, Quad } from './geometry.ts';

export interface TrackedOutline {
  /** Zero-based frame index in the clip. */
  readonly frame: number;
  /** The container's outline in that frame, in video pixels. */
  readonly corners: Quad;
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export interface FrameCandidate {
  readonly frame: number;
  /** 0–1: higher when the outline is larger and closer to a square-on rectangle. */
  readonly score: number;
}

/** What a model saw in one candidate frame. */
export interface FaceView {
  /** The face shown square-on, or `null` when no single face is. */
  readonly face: Face | null;
  /** True when the face is seen roughly square-on and whole. */
  readonly squareOn: boolean;
}

export interface CandidateOptions {
  /** Chosen frames are at least this many frames apart. */
  readonly minGap: number;
  /** At most this many frames. Default 12. */
  readonly max?: number;
  /** Corners closer than this share of the shorter side to the frame edge mean the face is cut off. Default 0.01. */
  readonly margin?: number;
  /** The outline must cover at least this share of the frame. Default 0.1. */
  readonly minArea?: number;
}

/** 1 for a rectangle seen square-on, falling towards 0 as its corners stop being right angles. */
export function squareness(quad: Quad): number {
  let deviation = 0;
  for (let i = 0; i < 4; i++) {
    const at = quad[i] as Point;
    const prev = quad[(i + 3) % 4] as Point;
    const next = quad[(i + 1) % 4] as Point;
    const a = { x: prev.x - at.x, y: prev.y - at.y };
    const b = { x: next.x - at.x, y: next.y - at.y };
    const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
    // |cos| of the corner angle: 0 at a right angle, 1 when the edges fold flat.
    deviation += lengths === 0 ? 1 : Math.abs(a.x * b.x + a.y * b.y) / lengths;
  }
  return Math.max(0, 1 - deviation / 4);
}

/** Shoelace area of a quadrilateral. */
function area(quad: Quad): number {
  let twice = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i] as Point;
    const b = quad[(i + 1) % 4] as Point;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * How good a frame is as a face photo: 0 when the outline touches the frame
 * edge (the face is cut off, so it can't be registered) or is too small;
 * otherwise its share of the frame, weighted by how square-on it is.
 */
export function frameScore(
  corners: Quad,
  size: FrameSize,
  options: Pick<CandidateOptions, 'margin' | 'minArea'> = {},
): number {
  const margin = (options.margin ?? 0.01) * Math.min(size.width, size.height);
  const inside = corners.every(
    (p) =>
      p.x >= margin && p.y >= margin && p.x <= size.width - margin && p.y <= size.height - margin,
  );
  if (!inside) return 0;
  const share = area(corners) / (size.width * size.height);
  if (share < (options.minArea ?? 0.1)) return 0;
  return Math.min(1, share) * squareness(corners) ** 2;
}

/**
 * The best frames of a clip, spread through it: the highest-scoring frame is
 * taken first, then the next best at least `minGap` frames from every frame
 * already taken, and so on. Returned in clip order.
 */
export function pickCandidateFrames(
  outlines: readonly TrackedOutline[],
  size: FrameSize,
  options: CandidateOptions,
): FrameCandidate[] {
  const scored = outlines
    .map(({ frame, corners }) => ({ frame, score: frameScore(corners, size, options) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.frame - b.frame);
  const chosen: FrameCandidate[] = [];
  for (const candidate of scored) {
    if (chosen.length >= (options.max ?? 12)) break;
    if (chosen.every((c) => Math.abs(c.frame - candidate.frame) >= options.minGap)) {
      chosen.push(candidate);
    }
  }
  return chosen.sort((a, b) => a.frame - b.frame);
}

/** For each face, the highest-scoring candidate the model saw square-on as that face. */
export function bestFramePerFace(
  candidates: readonly FrameCandidate[],
  views: readonly FaceView[],
): Map<Face, FrameCandidate> {
  const best = new Map<Face, FrameCandidate>();
  candidates.forEach((candidate, i) => {
    const view = views[i];
    if (!view?.face || !view.squareOn) return;
    const current = best.get(view.face);
    if (!current || candidate.score > current.score) best.set(view.face, candidate);
  });
  return best;
}

/**
 * The face in view at a frame: the face of the nearest named candidate, if
 * it's within `maxDistance` frames. Used to draw the right face's sections
 * while the clip plays.
 */
export function faceAtFrame(
  named: readonly { readonly frame: number; readonly face: Face | null }[],
  frame: number,
  maxDistance: number,
): Face | null {
  let nearest: { distance: number; face: Face | null } | undefined;
  for (const item of named) {
    const distance = Math.abs(item.frame - frame);
    if (distance <= maxDistance && (!nearest || distance < nearest.distance)) {
      nearest = { distance, face: item.face };
    }
  }
  return nearest?.face ?? null;
}
