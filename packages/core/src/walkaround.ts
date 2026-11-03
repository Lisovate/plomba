/**
 * Turning a recorded walk-around into face photos. The container's outline is
 * tracked through every frame of the clip; these functions choose the frames
 * worth looking at (one face, whole, large and square-on), and then the best
 * frame of each face once a model has named the faces.
 */

import type { Face } from './faces.ts';
import { type Point, type Quad, quadArea } from './geometry.ts';

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
  /** False when the face is blurred or partly covered (a hand, a person). Missing counts as clear. */
  readonly clear?: boolean;
  /** Seen corner-on: the faces either side of the near edge. */
  readonly corner?: { readonly left: Face; readonly right: Face } | null;
}

/** How much a blurred or covered frame counts against a clear one. */
const UNCLEAR_WEIGHT = 0.5;

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
  const share = quadArea(corners) / (size.width * size.height);
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

/**
 * For each face, the best candidate the model saw square-on as that face: the
 * highest score, with frames that are blurred or partly covered counting half.
 */
export function bestFramePerFace(
  candidates: readonly FrameCandidate[],
  views: readonly FaceView[],
): Map<Face, FrameCandidate> {
  const best = new Map<Face, { candidate: FrameCandidate; weighted: number }>();
  candidates.forEach((candidate, i) => {
    const view = views[i];
    if (!view?.face || !view.squareOn) return;
    const weighted = candidate.score * (view.clear === false ? UNCLEAR_WEIGHT : 1);
    const current = best.get(view.face);
    if (!current || weighted > current.weighted) best.set(view.face, { candidate, weighted });
  });
  return new Map([...best].map(([face, { candidate }]) => [face, candidate]));
}

/**
 * What is in view at a frame: the view of the nearest named frame, if it's
 * within `maxDistance` frames. Used to draw the right faces while the clip
 * plays.
 */
export function viewAtFrame<T>(
  named: readonly { readonly frame: number; readonly view: T | null }[],
  frame: number,
  maxDistance: number,
): T | null {
  let nearest: { distance: number; view: T | null } | undefined;
  for (const item of named) {
    const distance = Math.abs(item.frame - frame);
    if (distance <= maxDistance && (!nearest || distance < nearest.distance)) {
      nearest = { distance, view: item.view };
    }
  }
  return nearest?.view ?? null;
}

/** A container seen corner-on: the two faces either side of the near vertical edge. */
export interface CornerSplit {
  readonly left: Quad;
  readonly right: Quad;
}

/** Signed distance of `p` from the line through `a` and `b`, positive on the side the image y axis points (below). */
function belowLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / -Math.hypot(dx, dy);
}

/**
 * Splits a container's outline seen corner-on, from about eye level, into
 * its two faces. The near vertical edge is the closest part of the
 * container, so it looks taller than the outer edges: its foot stands out
 * below the line between the outer bottom corners, and its top out above the
 * line between the outer top corners, at the same x.
 *
 * Returns `null` for a single face seen square-on (nothing stands out), when
 * the top doesn't line up with the foot (seen from above, the top of the
 * outline is the roof's far edge), or when either face would be a sliver.
 *
 * @param outline points of the outline, e.g. its convex hull
 * @param corners the outline's outer corners (`quadFromPoints`)
 */
export function splitCornerView(outline: readonly Point[], corners: Quad): CornerSplit | null {
  const [tl, tr, br, bl] = corners;
  const width = (tr.x - tl.x + (br.x - bl.x)) / 2;
  const height = (bl.y - tl.y + (br.y - tr.y)) / 2;
  if (width <= 0 || height <= 0) return null;

  let foot: { point: Point; bulge: number } | undefined;
  let top: { point: Point; bulge: number } | undefined;
  for (const p of outline) {
    const footBulge = belowLine(p, bl, br);
    if (p.x > bl.x && p.x < br.x && (!foot || footBulge > foot.bulge))
      foot = { point: p, bulge: footBulge };
    const topBulge = -belowLine(p, tl, tr);
    if (p.x > tl.x && p.x < tr.x && (!top || topBulge > top.bulge))
      top = { point: p, bulge: topBulge };
  }
  if (!foot || !top) return null;
  // The foot stands out more than the top whenever the eye is below the roof.
  if (foot.bulge < 0.03 * height || top.bulge < 0.005 * height) return null;
  if (Math.abs(foot.point.x - top.point.x) > 0.06 * width) return null;
  const edge = (foot.point.x + top.point.x) / 2;
  if (edge - (tl.x + bl.x) / 2 < 0.1 * width || (tr.x + br.x) / 2 - edge < 0.1 * width) return null;

  return {
    left: [tl, top.point, foot.point, bl],
    right: [top.point, tr, br, foot.point],
  };
}

/** The faces around the container, each followed by the one to its right when seen from outside. */
const AROUND: readonly Face[] = ['D', 'R', 'F', 'L'];

/**
 * True when `left` and `right` can be the faces either side of a vertical
 * corner seen from outside: going round the container, the right-hand face
 * always follows the left-hand one (doors, right side, front, left side).
 */
export function isCornerPair(left: Face, right: Face): boolean {
  const i = AROUND.indexOf(left);
  return i >= 0 && AROUND[(i + 1) % AROUND.length] === right;
}

/** A frame, or one face of a corner view, kept as a photo of a face. */
export interface PhotoChoice {
  /** Index into the candidates. */
  readonly index: number;
  readonly part: 'whole' | 'left' | 'right';
  readonly face: Face;
}

/**
 * The photos to keep from a walk-around: for each face, the best frame that
 * shows it whole and square-on (`bestFramePerFace`); for a face no such frame
 * shows, the corner view where that face's part is largest.
 */
export function chooseWalkaroundPhotos(
  candidates: readonly (FrameCandidate & {
    readonly view: FaceView;
    readonly split: CornerSplit | null;
  })[],
): PhotoChoice[] {
  // A corner view's outline covers two faces, so it can only be used split.
  const whole = bestFramePerFace(
    candidates,
    candidates.map((c) => (c.split && c.view.corner ? { ...c.view, squareOn: false } : c.view)),
  );
  const choices: PhotoChoice[] = [...whole].map(([face, best]) => ({
    index: candidates.findIndex((c) => c.frame === best.frame),
    part: 'whole' as const,
    face,
  }));
  const parts = new Map<Face, { choice: PhotoChoice; area: number }>();
  candidates.forEach(({ view, split }, index) => {
    if (!view.corner || !split || view.clear === false) return;
    for (const part of ['left', 'right'] as const) {
      const face = view.corner[part];
      const area = quadArea(split[part]);
      if (whole.has(face) || (parts.get(face)?.area ?? 0) >= area) continue;
      parts.set(face, { choice: { index, part, face }, area });
    }
  });
  return [...choices, ...[...parts.values()].map((p) => p.choice)];
}
