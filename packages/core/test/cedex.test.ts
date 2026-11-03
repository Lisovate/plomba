import { describe, expect, it } from 'vitest';
import {
  faceCells,
  faceCoverage,
  isDamageCode,
  locationCode,
  longSectionCount,
  sectionRect,
} from '../src/cedex.ts';
import { faceSize, rectOverlap } from '../src/faces.ts';
import { parseSizeType } from '../src/size-type.ts';

const twenty = parseSizeType('22G1')?.dimensions;
const forty = parseSizeType('42G1')?.dimensions;
if (!twenty || !forty) throw new Error('size type fixtures failed to parse');

// One section on a 20 ft side is 6.058 / 5 ≈ 1.21 m; on a 40 ft side 12.192 / 10 ≈ 1.22 m.
const section20 = twenty.length / 5;

describe('longSectionCount', () => {
  it('uses 5 sections on 20 ft and 10 on 40 ft', () => {
    expect(longSectionCount(twenty)).toBe(5);
    expect(longSectionCount(forty)).toBe(10);
  });
});

describe('locationCode on the sides', () => {
  it('counts right-side sections from the door end (u = 0 at the doors)', () => {
    const rect = { u0: 0.2, v0: 0.2, u1: 0.5, v1: 0.6 };
    expect(locationCode('R', rect, twenty)).toBe('RB1N');
  });

  it('counts left-side sections from the door end (u = 0 at the front)', () => {
    // Near the viewer's left edge of the left side, which is the front end: section 5.
    const rect = { u0: 0.2, v0: 2.0, u1: 0.5, v1: 2.3 };
    expect(locationCode('L', rect, twenty)).toBe('LT5N');
  });

  it('gives first and last section for a mark spanning adjacent sections', () => {
    const rect = { u0: section20 * 1.5, v0: 1.6, u1: section20 * 3.5, v1: 2.0 };
    expect(locationCode('R', rect, twenty)).toBe('RT24');
  });

  it('uses X for a mark crossing both halves and XX for the whole length', () => {
    const rect = { u0: 0, v0: 0.5, u1: twenty.length, v1: 2.0 };
    expect(locationCode('L', rect, twenty)).toBe('LXXX');
  });

  it('numbers the tenth section of a 40 ft side as 0', () => {
    const rect = { u0: forty.length - 0.4, v0: 0.1, u1: forty.length - 0.1, v1: 0.3 };
    expect(locationCode('R', rect, forty)).toBe('RB0N');
  });

  it('does not spill into the next section when a mark ends on a boundary', () => {
    const rect = { u0: 0, v0: 0.1, u1: section20, v1: 0.3 };
    expect(locationCode('R', rect, twenty)).toBe('RB1N');
  });
});

describe('locationCode on the ends', () => {
  const { width } = faceSize('D', twenty);

  it('numbers door-end sections from the left corner post', () => {
    expect(locationCode('D', { u0: 0, v0: 2, u1: 0.1, v1: 2.3 }, twenty)).toBe('DT1N');
    expect(locationCode('D', { u0: 0.5, v0: 0.1, u1: 0.8, v1: 0.4 }, twenty)).toBe('DB2N');
    expect(locationCode('D', { u0: width - 0.1, v0: 0.1, u1: width, v1: 0.4 }, twenty)).toBe(
      'DB4N',
    );
  });

  it('mirrors the front end, which is numbered as seen from the door end', () => {
    // The viewer's left on the front end is the container's right corner post.
    expect(locationCode('F', { u0: 0, v0: 0.1, u1: 0.1, v1: 0.4 }, twenty)).toBe('FB4N');
  });
});

describe('locationCode on the roof', () => {
  it('uses left and right halves', () => {
    expect(locationCode('T', { u0: 0.1, v0: 1.5, u1: 0.4, v1: 2.0 }, twenty)).toBe('TL1N');
    expect(locationCode('T', { u0: 0.1, v0: 0.1, u1: 0.4, v1: 0.5 }, twenty)).toBe('TR1N');
  });
});

describe('faceCells', () => {
  it('splits a 20 ft side into 5 sections × 2 halves with unique codes', () => {
    const cells = faceCells('L', twenty);
    expect(cells).toHaveLength(10);
    expect(new Set(cells.map((c) => c.code)).size).toBe(10);
    expect(cells.map((c) => c.code)).toContain('LT1N');
  });

  it('gives each cell its own code when coded back', () => {
    for (const face of ['D', 'R', 'F', 'L', 'T'] as const) {
      for (const cell of faceCells(face, forty)) {
        expect(locationCode(face, cell.rect, forty)).toBe(cell.code);
      }
    }
  });
});

describe('code lists', () => {
  it('keeps damage codes separate from locations', () => {
    expect(isDamageCode('DT')).toBe(true);
    expect(isDamageCode('toString')).toBe(false);
  });
});

describe('rectOverlap', () => {
  it('is 1 for identical rectangles, 0 for separate ones and in between otherwise', () => {
    const a = { u0: 0, v0: 0, u1: 2, v1: 1 };
    expect(rectOverlap(a, a)).toBe(1);
    expect(rectOverlap(a, { u0: 3, v0: 0, u1: 4, v1: 1 })).toBe(0);
    expect(rectOverlap(a, { u0: 1, v0: 0, u1: 3, v1: 1 })).toBeCloseTo(1 / 3);
  });
});

describe('coverage', () => {
  // A 40 ft right side photographed head-on, filling a 1000 × 250 photo.
  const fullFrame = {
    width: 1000,
    height: 250,
    corners: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 250 },
      { x: 0, y: 250 },
    ] as const,
  };

  it('covers every cell when the whole face is in the photo', () => {
    const coverage = faceCoverage('R', forty, [fullFrame]);
    expect(coverage.total).toBe(20);
    expect(coverage.missing).toEqual([]);
  });

  it('covers only the sections that are fully in the photo', () => {
    // The face runs off the right edge: only the door-end half is visible.
    const half = {
      width: 1000,
      height: 250,
      corners: [
        { x: 0, y: 0 },
        { x: 2000, y: 0 },
        { x: 2000, y: 250 },
        { x: 0, y: 250 },
      ] as const,
    };
    const coverage = faceCoverage('R', forty, [half]);
    expect(coverage.covered).toHaveLength(10);
    expect(coverage.covered).toContain('RT1N');
    expect(coverage.missing).toContain('RT0N');
  });

  it('adds up several photos and ignores unregistered ones', () => {
    const coverage = faceCoverage('R', forty, [{ ...fullFrame, corners: null }]);
    expect(coverage.covered).toEqual([]);
    expect(faceCoverage('R', forty, [{ ...fullFrame, corners: null }, fullFrame]).missing).toEqual(
      [],
    );
  });
});

describe('sectionRect', () => {
  it('is the inverse of locationCode on every face', () => {
    const cases = [
      ['L', { from: 3, to: 3, half: 'lower' }, 'LB3N'],
      ['R', { from: 1, to: 2, half: 'upper' }, 'RT12'],
      ['L', { from: 9, to: 10, half: null }, 'LX90'],
      ['T', { from: 4, to: 4, half: 'left' }, 'TL4N'],
      ['D', { from: 2, to: 3, half: 'lower' }, 'DB23'],
      ['F', { from: 1, to: 1, half: 'upper' }, 'FT1N'],
      ['R', { from: 1, to: 10, half: null }, 'RXXX'],
    ] as const;
    for (const [face, location, code] of cases) {
      expect(locationCode(face, sectionRect(face, forty, location), forty)).toBe(code);
    }
  });

  it('counts the left side and the front end against their u axis', () => {
    // Section 1 is at the door end, which is on the viewer's right on the left side.
    const rect = sectionRect('L', twenty, { from: 1, to: 1, half: null });
    expect(rect.u1).toBeCloseTo(faceSize('L', twenty).width, 5);
  });

  it('refuses sections or halves the face does not have', () => {
    expect(() => sectionRect('L', twenty, { from: 6, to: 6, half: null })).toThrow(RangeError);
    expect(() => sectionRect('D', forty, { from: 0, to: 1, half: null })).toThrow(RangeError);
    expect(() => sectionRect('T', forty, { from: 1, to: 1, half: 'upper' })).toThrow(RangeError);
    expect(() => sectionRect('R', forty, { from: 1, to: 1, half: 'left' })).toThrow(RangeError);
  });
});
