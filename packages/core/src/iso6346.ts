/**
 * ISO 6346 container identification: a 3-letter owner code, an equipment
 * category letter, a 6-digit serial number and a check digit.
 *
 * The check digit catches most single misreads, but not all: letters whose
 * values differ by a multiple of 11 (A/K/U, B/L/V, C/M/W, …) produce the same
 * check digit. Callers that repair a misread number must treat several valid
 * candidates as ambiguous rather than pick one silently.
 */

/** U = freight container, J = detachable freight container equipment, Z = trailer or chassis. */
export type EquipmentCategory = 'U' | 'J' | 'Z';

export const EQUIPMENT_CATEGORIES: readonly EquipmentCategory[] = ['U', 'J', 'Z'];

export interface ContainerNumber {
  /** Normalised 11-character form, e.g. `CSQU3054383`. */
  readonly value: string;
  readonly ownerCode: string;
  readonly category: EquipmentCategory;
  readonly serial: string;
  readonly checkDigit: number;
}

export type ContainerNumberError =
  | { readonly code: 'length'; readonly length: number }
  | { readonly code: 'owner-code' }
  | { readonly code: 'category' }
  | { readonly code: 'serial' }
  | { readonly code: 'check-digit-mismatch'; readonly expected: number; readonly found: number };

export type ContainerNumberResult =
  | { readonly ok: true; readonly value: ContainerNumber }
  | { readonly ok: false; readonly error: ContainerNumberError };

const LETTER_VALUES: ReadonlyMap<string, number> = (() => {
  const values = new Map<string, number>();
  let value = 10;
  for (let code = 65; code <= 90; code++) {
    if (value % 11 === 0) value++;
    values.set(String.fromCharCode(code), value);
    value++;
  }
  return values;
})();

/** Strips spaces, dashes and dots and upper-cases, so `cs qu-305438.3` becomes `CSQU3054383`. */
export function normaliseContainerNumber(raw: string): string {
  return raw.toUpperCase().replace(/[\s.\-_/]/g, '');
}

function characterValue(char: string): number {
  if (char >= '0' && char <= '9') return char.charCodeAt(0) - 48;
  const value = LETTER_VALUES.get(char);
  if (value === undefined) throw new RangeError(`Not a valid ISO 6346 character: ${char}`);
  return value;
}

/**
 * Computes the check digit for the first 10 characters (owner code, category, serial).
 * A remainder of 10 maps to 0, as the standard specifies.
 */
export function computeCheckDigit(firstTen: string): number {
  if (firstTen.length !== 10) {
    throw new RangeError(`Expected 10 characters, got ${firstTen.length}`);
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += characterValue(firstTen.charAt(i)) * 2 ** i;
  }
  return (sum % 11) % 10;
}

const OWNER_CODE = /^[A-Z]{3}$/;
const SERIAL = /^\d{6}$/;

export function parseContainerNumber(raw: string): ContainerNumberResult {
  const value = normaliseContainerNumber(raw);
  if (value.length !== 11) return { ok: false, error: { code: 'length', length: value.length } };

  const ownerCode = value.slice(0, 3);
  const category = value.charAt(3);
  const serial = value.slice(4, 10);
  const checkChar = value.charAt(10);

  if (!OWNER_CODE.test(ownerCode)) return { ok: false, error: { code: 'owner-code' } };
  if (!isEquipmentCategory(category)) return { ok: false, error: { code: 'category' } };
  if (!SERIAL.test(serial) || !/^\d$/.test(checkChar)) {
    return { ok: false, error: { code: 'serial' } };
  }

  const expected = computeCheckDigit(value.slice(0, 10));
  const found = Number(checkChar);
  if (expected !== found) {
    return { ok: false, error: { code: 'check-digit-mismatch', expected, found } };
  }
  return { ok: true, value: { value, ownerCode, category, serial, checkDigit: found } };
}

export function isValidContainerNumber(raw: string): boolean {
  return parseContainerNumber(raw).ok;
}

/** Formats as painted on the doors: `CSQU 305438 3`. */
export function formatContainerNumber(number: ContainerNumber | string): string {
  const value = typeof number === 'string' ? normaliseContainerNumber(number) : number.value;
  return `${value.slice(0, 4)} ${value.slice(4, 10)} ${value.slice(10)}`;
}

function isEquipmentCategory(char: string): char is EquipmentCategory {
  return (EQUIPMENT_CATEGORIES as readonly string[]).includes(char);
}

/**
 * Characters that are commonly confused when stencilled markings are read by
 * eye or by a vision model (worn paint, corrugation, glare). Keys are what was
 * read; values are what it may really be.
 */
const LETTER_LOOKALIKES: Readonly<Record<string, string>> = {
  O: 'CQDU',
  C: 'OGQ',
  Q: 'OC',
  D: 'OB',
  G: 'CO',
  B: 'ERD',
  E: 'FB',
  F: 'EP',
  P: 'RF',
  R: 'PB',
  I: 'LTJ',
  L: 'I',
  T: 'I',
  J: 'UI',
  M: 'NWH',
  N: 'MH',
  H: 'NM',
  W: 'MV',
  U: 'VOJ',
  V: 'UY',
  Y: 'V',
  K: 'X',
  X: 'K',
  // Digits read where the owner code and category must be letters.
  '0': 'OCDQU',
  '1': 'IJLT',
  '2': 'Z',
  '3': 'B',
  '4': 'A',
  '5': 'S',
  '6': 'GC',
  '7': 'T',
  '8': 'B',
  '9': 'SGQ',
};

const DIGIT_LOOKALIKES: Readonly<Record<string, string>> = {
  '0': '869',
  '1': '7',
  '2': '7',
  '3': '8',
  '5': '6',
  '6': '508',
  '7': '12',
  '8': '3069',
  '9': '08',
  // Letters read where the serial and check digit must be digits.
  O: '0',
  D: '0',
  Q: '0',
  C: '0',
  U: '0',
  I: '1',
  L: '1',
  J: '1',
  Z: '2',
  E: '3',
  A: '4',
  S: '5',
  G: '6',
  T: '7',
  B: '8',
};

export interface ContainerNumberCandidate {
  readonly value: ContainerNumber;
  /** Positions (0–10) where the candidate differs from what was read. */
  readonly changedPositions: readonly number[];
}

export interface SuggestOptions {
  /**
   * Maximum number of valid characters to change. Characters that can't stand
   * where they are (a digit in the owner code, a letter in the serial) are
   * always replaced and don't count. Defaults to 2.
   */
  readonly maxChanges?: number;
}

/**
 * Proposes valid container numbers close to a misread one by swapping
 * look-alike characters. Returns candidates ordered by the number of changes;
 * an exact valid read is returned alone with no changes.
 *
 * More than one candidate with the same number of changes means the read is
 * ambiguous and a person (or a second, focused model read) must decide.
 */
export function suggestContainerNumbers(
  raw: string,
  options: SuggestOptions = {},
): ContainerNumberCandidate[] {
  const maxChanges = options.maxChanges ?? 2;
  const read = normaliseContainerNumber(raw);
  if (read.length !== 11) return [];

  const exact = parseContainerNumber(read);
  if (exact.ok) return [{ value: exact.value, changedPositions: [] }];

  const alternatives = [...read].map((char, position) => positionAlternatives(char, position));
  const results = new Map<string, ContainerNumberCandidate>();

  const search = (position: number, prefix: string, changed: number[], optional: number): void => {
    if (position === 11) {
      const parsed = parseContainerNumber(prefix);
      if (parsed.ok && !results.has(parsed.value.value)) {
        results.set(parsed.value.value, { value: parsed.value, changedPositions: [...changed] });
      }
      return;
    }
    const readChar = read.charAt(position);
    const { options, forced } = alternatives[position] ?? { options: [], forced: false };
    for (const char of options) {
      const isChange = char !== readChar;
      const isOptional = isChange && !forced;
      if (isOptional && optional >= maxChanges) continue;
      if (isChange) changed.push(position);
      search(position + 1, prefix + char, changed, optional + (isOptional ? 1 : 0));
      if (isChange) changed.pop();
    }
  };
  search(0, '', [], 0);

  return [...results.values()].sort(
    (a, b) =>
      a.changedPositions.length - b.changedPositions.length ||
      a.value.value.localeCompare(b.value.value),
  );
}

function positionAlternatives(
  char: string,
  position: number,
): { options: string[]; forced: boolean } {
  const fitsPosition = (candidate: string): boolean => {
    if (position < 3) return candidate >= 'A' && candidate <= 'Z';
    if (position === 3) return isEquipmentCategory(candidate);
    return candidate >= '0' && candidate <= '9';
  };
  const lookalikes = position < 4 ? LETTER_LOOKALIKES[char] : DIGIT_LOOKALIKES[char];
  const options = [...new Set([char, ...(lookalikes ?? '')])].filter(fitsPosition);
  return { options, forced: !fitsPosition(char) };
}
