/**
 * The container's own coordinate system. Plomba stores every mark relative to
 * a face of the container, not to the room or the photo, so a mark recorded in
 * one city can be drawn on the same container in another.
 *
 * Each face uses (u, v) in metres from its bottom-left corner as seen by a
 * person standing outside the face and looking at it: u to the right, v up.
 * For the roof the viewer looks down with the door end on their left, so u runs
 * from the door end to the front and v from the right side to the left side.
 *
 * Left and right are as seen from the door end looking towards the front.
 */

import type { ContainerDimensions } from './size-type.ts';

/** Faces by their ISO 9897 (CEDEX) location letter. */
export type Face = 'D' | 'R' | 'F' | 'L' | 'T';

/** The walk-around order: doors first, then counter-clockwise seen from above. */
export const FACES: readonly Face[] = ['D', 'R', 'F', 'L', 'T'];

export const FACE_NAMES: Readonly<Record<Face, string>> = {
  D: 'Door end',
  R: 'Right side',
  F: 'Front end',
  L: 'Left side',
  T: 'Roof',
};

export interface FaceSize {
  /** Extent along u, in metres. */
  readonly width: number;
  /** Extent along v, in metres. */
  readonly height: number;
}

/** A rectangle on a face in metres, with u0 ≤ u1 and v0 ≤ v1. */
export interface FaceRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export function faceSize(face: Face, dimensions: ContainerDimensions): FaceSize {
  switch (face) {
    case 'L':
    case 'R':
      return { width: dimensions.length, height: dimensions.height };
    case 'D':
    case 'F':
      return { width: dimensions.width, height: dimensions.height };
    case 'T':
      return { width: dimensions.length, height: dimensions.width };
  }
}

/** True for faces that run along the container's length (sides and roof). */
export function isLongFace(face: Face): face is 'L' | 'R' | 'T' {
  return face === 'L' || face === 'R' || face === 'T';
}

/**
 * The span a rectangle covers along the axis the CEDEX sections are counted on:
 * - sides and roof: metres from the door end towards the front;
 * - ends: metres from the left corner post, as seen from the door end.
 */
export function sectionAxisSpan(
  face: Face,
  rect: FaceRect,
  dimensions: ContainerDimensions,
): readonly [number, number] {
  const { width } = faceSize(face, dimensions);
  switch (face) {
    case 'R':
    case 'T':
    case 'D':
      return [rect.u0, rect.u1];
    // On the left side the viewer's right is the door end; on the front end the
    // viewer's right is the container's left. Both run against the axis.
    case 'L':
    case 'F':
      return [width - rect.u1, width - rect.u0];
  }
}

/** Clamps a rectangle to the face it belongs to. */
export function clampToFace(face: Face, rect: FaceRect, dimensions: ContainerDimensions): FaceRect {
  const { width, height } = faceSize(face, dimensions);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return {
    u0: clamp(Math.min(rect.u0, rect.u1), width),
    v0: clamp(Math.min(rect.v0, rect.v1), height),
    u1: clamp(Math.max(rect.u0, rect.u1), width),
    v1: clamp(Math.max(rect.v0, rect.v1), height),
  };
}
