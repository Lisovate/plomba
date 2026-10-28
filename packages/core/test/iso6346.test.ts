import { describe, expect, it } from 'vitest';
import {
  computeCheckDigit,
  formatContainerNumber,
  isValidContainerNumber,
  normaliseContainerNumber,
  parseContainerNumber,
  suggestContainerNumbers,
} from '../src/iso6346.ts';

describe('computeCheckDigit', () => {
  it('matches the reference example from ISO 6346', () => {
    expect(computeCheckDigit('CSQU305438')).toBe(3);
  });

  it('maps a remainder of 10 to 0', () => {
    // The weighted sum for CSQU000007 is 4025, and 4025 mod 11 = 10.
    expect(computeCheckDigit('CSQU000007')).toBe(0);
  });

  it('rejects a prefix of the wrong length', () => {
    expect(() => computeCheckDigit('CSQU30543')).toThrow(RangeError);
  });
});

describe('parseContainerNumber', () => {
  it('parses a valid number written with spaces', () => {
    const result = parseContainerNumber('csqu 305438 3');
    expect(result).toEqual({
      ok: true,
      value: {
        value: 'CSQU3054383',
        ownerCode: 'CSQ',
        category: 'U',
        serial: '305438',
        checkDigit: 3,
      },
    });
  });

  it('reports a check digit mismatch with the expected digit', () => {
    expect(parseContainerNumber('CSQU3054384')).toEqual({
      ok: false,
      error: { code: 'check-digit-mismatch', expected: 3, found: 4 },
    });
  });

  it.each([
    ['CSQU305438', { code: 'length', length: 10 }],
    ['C5QU3054383', { code: 'owner-code' }],
    ['CSQX3054383', { code: 'category' }],
    ['CSQU30543B3', { code: 'serial' }],
  ])('rejects %s', (raw, error) => {
    expect(parseContainerNumber(raw)).toEqual({ ok: false, error });
  });
});

describe('formatting', () => {
  it('normalises separators and case', () => {
    expect(normaliseContainerNumber(' cSqU-305.438 3 ')).toBe('CSQU3054383');
  });

  it('formats as painted on the doors', () => {
    expect(formatContainerNumber('CSQU3054383')).toBe('CSQU 305438 3');
  });
});

describe('suggestContainerNumbers', () => {
  it('returns an exact valid read unchanged', () => {
    const [candidate, ...rest] = suggestContainerNumbers('CSQU3054383');
    expect(candidate?.value.value).toBe('CSQU3054383');
    expect(candidate?.changedPositions).toEqual([]);
    expect(rest).toEqual([]);
  });

  it('repairs a worn C read as O (a real Muse Spark misread of LSCU 107737 9)', () => {
    expect(isValidContainerNumber('LSOU1077379')).toBe(false);
    const candidates = suggestContainerNumbers('LSOU1077379');
    const values = candidates.map((c) => c.value.value);
    expect(values).toContain('LSCU1077379');
    const repaired = candidates.find((c) => c.value.value === 'LSCU1077379');
    expect(repaired?.changedPositions).toEqual([2]);
  });

  it('coerces digits read in the owner code and letters read in the serial', () => {
    const values = suggestContainerNumbers('C5QU3O54383').map((c) => c.value.value);
    expect(values[0]).toBe('CSQU3054383');
  });

  it('orders candidates by the number of changes', () => {
    const candidates = suggestContainerNumbers('CSQU3054388');
    const changes = candidates.map((c) => c.changedPositions.length);
    expect(changes).toEqual([...changes].sort((a, b) => a - b));
    for (const candidate of candidates)
      expect(isValidContainerNumber(candidate.value.value)).toBe(true);
  });

  it('respects the change budget', () => {
    for (const candidate of suggestContainerNumbers('LSOU1077370', { maxChanges: 1 })) {
      expect(candidate.changedPositions.length).toBeLessThanOrEqual(1);
    }
  });

  it('returns nothing for a read of the wrong length', () => {
    expect(suggestContainerNumbers('LSOU107737')).toEqual([]);
  });
});
