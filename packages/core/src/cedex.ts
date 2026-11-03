/**
 * ISO 9897 (CEDEX) damage coding, following IICL TB 002 "Preferred EDIS for
 * the Container Industry".
 *
 * A location code has four characters: the face, the part of the face, and the
 * first and last section. One section puts `N` in fourth place; the whole
 * length (or width) is `XX`. Example: `LT5N` is the left side, top half,
 * section 5.
 *
 * The same letters mean different things in different code lists (`DT` is a
 * dent as a damage code but "door end, top half" as a location), so each list
 * has its own branded type.
 */

import { type Face, type FaceRect, faceSize, isLongFace, sectionAxisSpan } from './faces.ts';
import {
  faceToImage,
  type Homography,
  type Point,
  projectFaceRect,
  type Quad,
} from './geometry.ts';
import type { ContainerDimensions } from './size-type.ts';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type LocationCode = Brand<string, 'LocationCode'>;
export type DamageCode = keyof typeof DAMAGE_CODES;
export type ComponentCode = keyof typeof COMPONENT_CODES;

/** Damage codes (ISO 9897 Annex D, IICL preferred subset). */
export const DAMAGE_CODES = {
  BT: 'Bent',
  BR: 'Broken',
  BW: 'Bowed',
  CU: 'Cut',
  CK: 'Cracked',
  CW: 'Cracked weld',
  CO: 'Corroded',
  CT: 'Contaminated',
  DT: 'Dent',
  DL: 'Delaminated',
  DY: 'Dirty',
  GD: 'Gouged',
  HO: 'Holed',
  IR: 'Improper repair',
  LK: 'Leak',
  LO: 'Loose',
  MS: 'Missing',
  PH: 'Pin holes',
  OR: 'Odour',
} as const;

/** Component codes for dry freight containers (IICL TB 002, a subset). */
export const COMPONENT_CODES = {
  PAA: 'Panel',
  RLA: 'Rail, top or bottom',
  CPS: 'Corner post',
  CPA: 'Corner post assembly',
  CFG: 'Corner fitting',
  HEP: 'Header plate',
  LBA: 'Locking bar assembly',
  DHL: 'Locking handle assembly',
  HGH: 'Hinge assembly',
  DPL: 'Security (TIR) plate',
  FTP: 'Threshold plate',
  FPP: 'Floor, plywood',
  MOC: "Marking, owner's code",
  MSN: 'Marking, serial number and check digit',
  MST: 'Marking, size and type',
  MCE: 'Marking, ACEP',
} as const;

export function isDamageCode(code: string): code is DamageCode {
  return Object.hasOwn(DAMAGE_CODES, code);
}

export function isComponentCode(code: string): code is ComponentCode {
  return Object.hasOwn(COMPONENT_CODES, code);
}

/**
 * Sections along the sides, roof and floor: 5 on a 20 ft container and 10
 * (numbered 1–9, then 0) on a 40 ft one. Longer containers keep 10.
 */
export function longSectionCount(dimensions: ContainerDimensions): 5 | 10 {
  return dimensions.length < 7 ? 5 : 10;
}

/**
 * Ends are divided across the width into four sections: 1 the left corner
 * post, 2 the left half, 3 the right half, 4 the right corner post, seen from
 * the door end. The corner post width follows the ISO 1161 corner fitting.
 */
export const CORNER_POST_WIDTH = 0.162;

/** The section boundaries along the counting axis of a face, in metres. */
export function sectionBoundaries(face: Face, dimensions: ContainerDimensions): number[] {
  if (isLongFace(face)) {
    const count = longSectionCount(dimensions);
    const size = dimensions.length / count;
    return Array.from({ length: count + 1 }, (_, i) => i * size);
  }
  const width = dimensions.width;
  return [0, CORNER_POST_WIDTH, width / 2, width - CORNER_POST_WIDTH, width];
}

function sectionIndexAt(boundaries: readonly number[], position: number): number {
  const last = boundaries.length - 2;
  for (let i = 0; i <= last; i++) {
    if (position < (boundaries[i + 1] ?? Number.POSITIVE_INFINITY)) return i;
  }
  return last;
}

function sectionDigit(index: number): string {
  return String((index + 1) % 10);
}

/** The 2nd character: which part of the face the rectangle sits in. */
function partCode(face: Face, rect: FaceRect, dimensions: ContainerDimensions): string {
  const { height } = faceSize(face, dimensions);
  const middle = height / 2;
  if (face === 'T') {
    // On the roof v runs from the right side (0) to the left side.
    if (rect.v0 >= middle) return 'L';
    if (rect.v1 <= middle) return 'R';
    return 'X';
  }
  if (rect.v0 >= middle) return 'T';
  if (rect.v1 <= middle) return 'B';
  return 'X';
}

/**
 * The CEDEX location code for a rectangle on a face.
 *
 * Assumption to verify against ISO 9897 Annex C: sections on the sides and roof
 * are counted from the door end, as IICL TB 002 numbers side posts, roof bows
 * and cross-members.
 */
export function locationCode(
  face: Face,
  rect: FaceRect,
  dimensions: ContainerDimensions,
): LocationCode {
  const boundaries = sectionBoundaries(face, dimensions);
  const [start, end] = sectionAxisSpan(face, rect, dimensions);
  // A rectangle ending exactly on a boundary doesn't reach into the next section.
  const epsilon = 1e-6;
  const first = sectionIndexAt(boundaries, start);
  const last = Math.max(first, sectionIndexAt(boundaries, end - epsilon));
  const sectionCount = boundaries.length - 1;

  let sections: string;
  if (first === last) sections = `${sectionDigit(first)}N`;
  else if (first === 0 && last === sectionCount - 1) sections = 'XX';
  else sections = `${sectionDigit(first)}${sectionDigit(last)}`;

  return `${face}${partCode(face, rect, dimensions)}${sections}` as LocationCode;
}

/** A place on a face named the way a location code names it: a range of sections and a half. */
export interface SectionLocation {
  /** First and last section, numbered as in the code: from 1 at the door end (sides, roof), or 1–4 left to right as seen from the door end (ends). The tenth section of a 40 ft side is 10. */
  readonly from: number;
  readonly to: number;
  /** Upper or lower half of a side or end, left or right half of the roof; `null` for the full height. */
  readonly half: 'upper' | 'lower' | 'left' | 'right' | null;
}

/**
 * The rectangle a section range covers on a face: the inverse of
 * `locationCode`, for damage described in words ("left side, section 3,
 * lower half") rather than drawn. Throws `RangeError` for sections the face
 * doesn't have, or a half that doesn't apply to it.
 */
export function sectionRect(
  face: Face,
  dimensions: ContainerDimensions,
  location: SectionLocation,
): FaceRect {
  const boundaries = sectionBoundaries(face, dimensions);
  const count = boundaries.length - 1;
  const { from, to, half } = location;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > count) {
    throw new RangeError(`Face ${face} has sections 1 to ${count}`);
  }
  const roof = face === 'T';
  if (half && (half === 'left' || half === 'right') !== roof) {
    throw new RangeError(
      roof ? 'The roof has left and right halves' : `Face ${face} has upper and lower halves`,
    );
  }
  const { width, height } = faceSize(face, dimensions);
  // A micrometre inside the boundaries, so rounding on the mirrored faces can't
  // move an edge into the neighbouring section.
  const inset = 1e-6;
  const start = (boundaries[from - 1] ?? 0) + inset;
  const end = (boundaries[to] ?? width) - inset;
  // Sections run against u on the left side and the front end (see sectionAxisSpan).
  const [u0, u1] = face === 'L' || face === 'F' ? [width - end, width - start] : [start, end];
  // On the roof, v runs from the right side (0) to the left side.
  const upperHalf = half === 'upper' || half === 'left';
  const [v0, v1] = half === null ? [0, height] : upperHalf ? [height / 2, height] : [0, height / 2];
  return { u0, v0, u1, v1 };
}

export interface FaceCell {
  readonly code: LocationCode;
  readonly rect: FaceRect;
}

/**
 * Splits a face into the cells the CEDEX code distinguishes (sections × halves),
 * in face coordinates. Used to track which parts of the container have
 * photographic evidence.
 */
export function faceCells(face: Face, dimensions: ContainerDimensions): FaceCell[] {
  const { width, height } = faceSize(face, dimensions);
  const boundaries = sectionBoundaries(face, dimensions);
  const reversed = face === 'L' || face === 'F';
  const cells: FaceCell[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i] ?? 0;
    const b = boundaries[i + 1] ?? width;
    const [u0, u1] = reversed ? [width - b, width - a] : [a, b];
    for (const [v0, v1] of [
      [height / 2, height],
      [0, height / 2],
    ] as const) {
      const rect = { u0, v0, u1, v1 };
      cells.push({ code: locationCode(face, rect, dimensions), rect });
    }
  }
  return cells;
}

export interface PhotoFrame {
  readonly width: number;
  readonly height: number;
  /** The face's corners in the photo; `null` until registered. */
  readonly corners: Quad | null;
}

export interface FaceCoverage {
  readonly total: number;
  readonly covered: readonly LocationCode[];
  readonly missing: readonly LocationCode[];
}

/**
 * The CEDEX cells of a face that a photo shows completely: each cell's
 * outline, mapped into the photo, must lie inside it (with a 2% margin for
 * corners placed on the photo's edge).
 */
export function cellsInPhoto(
  face: Face,
  dimensions: ContainerDimensions,
  photo: PhotoFrame,
): LocationCode[] {
  if (!photo.corners) return [];
  let h: Homography;
  try {
    h = faceToImage(face, dimensions, photo.corners);
  } catch {
    return [];
  }
  const margin = 0.02 * Math.max(photo.width, photo.height);
  const inside = (p: Point) =>
    p.x >= -margin && p.x <= photo.width + margin && p.y >= -margin && p.y <= photo.height + margin;
  return faceCells(face, dimensions)
    .filter((cell) => projectFaceRect(h, cell.rect).every(inside))
    .map((cell) => cell.code);
}

/** Which cells of a face have photographic evidence in any of its photos. */
export function faceCoverage(
  face: Face,
  dimensions: ContainerDimensions,
  photos: readonly PhotoFrame[],
): FaceCoverage {
  const covered = new Set(photos.flatMap((photo) => cellsInPhoto(face, dimensions, photo)));
  const cells = faceCells(face, dimensions).map((cell) => cell.code);
  return {
    total: cells.length,
    covered: cells.filter((code) => covered.has(code)),
    missing: cells.filter((code) => !covered.has(code)),
  };
}
