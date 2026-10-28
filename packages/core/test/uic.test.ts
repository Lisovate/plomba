import { describe, expect, it } from 'vitest';
import { computeUicCheckDigit, formatWagonNumber, parseWagonNumber } from '../src/uic.ts';

describe('UIC wagon numbers', () => {
  it('computes the self-check digit of the reference example 21 81 2471 217-3', () => {
    expect(computeUicCheckDigit('21812471217')).toBe(3);
  });

  it('accepts a valid number written with spaces and a dash', () => {
    expect(parseWagonNumber('21 81 2471 217-3')).toEqual({ ok: true, value: '218124712173' });
  });

  it('reports the expected check digit for a misread', () => {
    expect(parseWagonNumber('21 81 2471 217-4')).toEqual({ ok: false, expected: 3 });
  });

  it('rejects anything that is not 12 digits', () => {
    expect(parseWagonNumber('2181 2471')).toEqual({ ok: false });
  });

  it('formats as painted on the wagon', () => {
    expect(formatWagonNumber('218124712173')).toBe('21 81 2471 217-3');
  });
});
