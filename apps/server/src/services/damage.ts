/**
 * Turns damage the models found in a photo into proposed marks on the
 * container: pixel outlines become rectangles and outlines in metres on the
 * face, through the photo's homography.
 */

import type { ComponentCode, DamageCode, Face, FaceRect, Point, Quad } from '@plomba/core';
import {
  applyHomography,
  type ContainerDimensions,
  clampToFace,
  convexHull,
  faceSize,
  faceToImage,
  invertHomography,
} from '@plomba/core';
import type { DamageFinding, PixelBox, SegmentedObject } from '../ports.ts';
import { maskBoundary } from './vision.ts';

/** Findings the model is less sure of than this are not proposed. */
export const MIN_FINDING_CONFIDENCE = 0.3;

/** A proposal mostly outside the face (another face, the ground) is dropped. */
const MIN_SHARE_ON_FACE = 0.5;

/** Outlines are stored with at most this many points. */
const MAX_OUTLINE_POINTS = 32;

export interface ProposalDraft {
  readonly rect: FaceRect;
  readonly outline: Point[];
  readonly damageCode: DamageCode;
  readonly componentCode: ComponentCode | null;
  readonly note: string;
}

function boxCorners(box: PixelBox): Point[] {
  return [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ];
}

function bounds(points: readonly Point[]): FaceRect {
  return {
    u0: Math.min(...points.map((p) => p.x)),
    v0: Math.min(...points.map((p) => p.y)),
    u1: Math.max(...points.map((p) => p.x)),
    v1: Math.max(...points.map((p) => p.y)),
  };
}

const area = (r: FaceRect) => Math.max(0, r.u1 - r.u0) * Math.max(0, r.v1 - r.v0);

function thin(points: readonly Point[], max: number): Point[] {
  if (points.length <= max) return [...points];
  const step = points.length / max;
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * step)] as Point);
}

/**
 * Maps each finding (and its SAM outline, where SAM found one) onto the face.
 * Findings below the confidence threshold, or mostly off the face, are dropped.
 */
export function findingsToDrafts(
  findings: readonly DamageFinding[],
  outlines: readonly (SegmentedObject | null)[],
  face: Face,
  dimensions: ContainerDimensions,
  corners: Quad,
): ProposalDraft[] {
  const imageToFace = invertHomography(faceToImage(face, dimensions, corners));
  const { width, height } = faceSize(face, dimensions);
  const drafts: ProposalDraft[] = [];

  findings.forEach((finding, index) => {
    if (finding.confidence < MIN_FINDING_CONFIDENCE) return;
    const object = outlines[index] ?? null;
    const imageOutline = convexHull(object ? maskBoundary(object) : boxCorners(finding.box));
    if (imageOutline.length < 3) return;
    const onFace = imageOutline.map((p) => applyHomography(imageToFace, p));
    const full = bounds(onFace);
    const rect = clampToFace(face, full, dimensions);
    if (area(full) === 0 || area(rect) / area(full) < MIN_SHARE_ON_FACE) return;

    const outline = thin(onFace, MAX_OUTLINE_POINTS).map((p) => ({
      x: Math.min(Math.max(p.x, 0), width),
      y: Math.min(Math.max(p.y, 0), height),
    }));
    const traced =
      object?.confidence === undefined ? '' : `, outlined by SAM 3.1 at ${pct(object.confidence)}`;
    drafts.push({
      rect,
      outline,
      damageCode: finding.damageCode,
      componentCode: finding.componentCode,
      note: `${finding.description} (Muse Spark ${pct(finding.confidence)}${traced})`,
    });
  });
  return drafts;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
