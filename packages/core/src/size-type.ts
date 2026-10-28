/**
 * ISO 6346 size and type codes (the 1995 four-character scheme, e.g. `22G1`,
 * `45G1`, `L5G1`): the first character gives the length, the second the
 * height and width, the last two the type.
 */

export interface ContainerDimensions {
  /** External length in metres. */
  readonly length: number;
  /** External width in metres. */
  readonly width: number;
  /** External height in metres. */
  readonly height: number;
}

export type TypeGroup =
  | 'general-purpose'
  | 'ventilated'
  | 'bulk'
  | 'named-cargo'
  | 'refrigerated'
  | 'insulated'
  | 'open-top'
  | 'platform'
  | 'tank'
  | 'air-surface';

export interface SizeType {
  readonly code: string;
  readonly lengthFeet: number;
  readonly dimensions: ContainerDimensions;
  readonly highCube: boolean;
  readonly typeGroup: TypeGroup;
}

const STANDARD_WIDTH = 2.438;

const LENGTHS: Readonly<Record<string, { feet: number; metres: number }>> = {
  '1': { feet: 10, metres: 2.991 },
  '2': { feet: 20, metres: 6.058 },
  '3': { feet: 30, metres: 9.125 },
  '4': { feet: 40, metres: 12.192 },
  L: { feet: 45, metres: 13.716 },
  M: { feet: 48, metres: 14.63 },
};

/** Second character: heights for the standard 8 ft width (codes 0–9). */
const HEIGHTS: Readonly<Record<string, number>> = {
  '0': 2.438,
  '2': 2.591,
  '4': 2.743,
  '5': 2.896,
  '6': 2.896,
  '8': 1.295,
  '9': 1.219,
};

const TYPE_GROUPS: Readonly<Record<string, TypeGroup>> = {
  G: 'general-purpose',
  V: 'ventilated',
  B: 'bulk',
  S: 'named-cargo',
  R: 'refrigerated',
  H: 'insulated',
  U: 'open-top',
  P: 'platform',
  T: 'tank',
  A: 'air-surface',
};

const SIZE_TYPE = /^[0-9A-Z]{2}[A-Z][0-9A-Z]$/;

/** Parses a size and type code, or returns `undefined` if it isn't one this module knows. */
export function parseSizeType(raw: string): SizeType | undefined {
  const code = raw.toUpperCase().replace(/\s/g, '');
  if (!SIZE_TYPE.test(code)) return undefined;

  const length = LENGTHS[code.charAt(0)];
  const height = HEIGHTS[code.charAt(1)];
  const typeGroup = TYPE_GROUPS[code.charAt(2)];
  if (!length || height === undefined || !typeGroup) return undefined;

  return {
    code,
    lengthFeet: length.feet,
    dimensions: { length: length.metres, width: STANDARD_WIDTH, height },
    highCube: height >= 2.896,
    typeGroup,
  };
}

/** Dimensions used when the size and type code is unknown: a 40 ft general-purpose container. */
export const DEFAULT_DIMENSIONS: ContainerDimensions = {
  length: 12.192,
  width: STANDARD_WIDTH,
  height: 2.591,
};
