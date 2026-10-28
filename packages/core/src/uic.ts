/**
 * UIC wagon numbers (12 digits, e.g. `21 81 2471 217-3`): the last digit is a
 * self-check digit computed with the Luhn scheme over the first eleven.
 */

/** Strips spaces, dashes and dots. */
export function normaliseWagonNumber(raw: string): string {
  return raw.replace(/[\s.-]/g, '');
}

/** The check digit for the first 11 digits: weights 2,1,2,1,… from the left, digit sums added. */
export function computeUicCheckDigit(firstEleven: string): number {
  if (!/^\d{11}$/.test(firstEleven)) throw new RangeError('Expected 11 digits');
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const product = Number(firstEleven[i]) * (i % 2 === 0 ? 2 : 1);
    sum += Math.floor(product / 10) + (product % 10);
  }
  return (10 - (sum % 10)) % 10;
}

export type WagonNumberResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly expected?: number };

export function parseWagonNumber(raw: string): WagonNumberResult {
  const value = normaliseWagonNumber(raw);
  if (!/^\d{12}$/.test(value)) return { ok: false };
  const expected = computeUicCheckDigit(value.slice(0, 11));
  return expected === Number(value[11]) ? { ok: true, value } : { ok: false, expected };
}

/** As painted on the wagon: `21 81 2471 217-3`. */
export function formatWagonNumber(value: string): string {
  const v = normaliseWagonNumber(value);
  return `${v.slice(0, 2)} ${v.slice(2, 4)} ${v.slice(4, 8)} ${v.slice(8, 11)}-${v.slice(11)}`;
}
