import { describe, expect, it } from 'vitest';
import { faceCells } from '../src/cedex.ts';
import type { FaceRect } from '../src/faces.ts';
import { damageHistory, type PassportHandover, type PassportMark } from '../src/passport.ts';
import { DEFAULT_DIMENSIONS } from '../src/size-type.ts';

const dent: FaceRect = { u0: 1.0, v0: 0.4, u1: 1.4, v1: 0.8 };

const mark = (id: string, overrides: Partial<PassportMark> = {}): PassportMark => ({
  id,
  face: 'L',
  rect: dent,
  locationCode: 'LB4N',
  damageCode: 'DT',
  status: 'new',
  previousMarkId: null,
  ...overrides,
});

/** The cells under the dent, as a sealed record lists them when they had no photo. */
const cellsUnderDent = faceCells('L', DEFAULT_DIMENSIONS)
  .filter(({ rect: c }) => c.u0 < dent.u1 && dent.u0 < c.u1 && c.v0 < dent.v1 && dent.v0 < c.v1)
  .map((c) => c.code as string);

const handover = (id: string, marks: PassportMark[] = [], skipped = false): PassportHandover => ({
  id,
  marks,
  notInspected: skipped ? { L: cellsUnderDent } : {},
});

describe('damageHistory', () => {
  it('places new damage after the last handover that inspected the spot', () => {
    const [history] = damageHistory(
      [handover('gdynia'), handover('lodz', [mark('m1')])],
      DEFAULT_DIMENSIONS,
    );
    expect(history).toMatchObject({
      firstRecorded: 'lodz',
      lastClear: 'gdynia',
      notInspectedAt: [],
    });
  });

  it('follows a damage confirmed at later handovers as one history', () => {
    const histories = damageHistory(
      [
        handover('gdynia'),
        handover('lodz', [mark('m1')]),
        handover('poznan', [mark('m2', { status: 'still-there', previousMarkId: 'm1' })]),
        handover('depot', [mark('m3', { status: 'repaired', previousMarkId: 'm2' })]),
      ],
      DEFAULT_DIMENSIONS,
    );
    expect(histories).toHaveLength(1);
    expect(histories[0]?.status).toBe('repaired');
    expect(histories[0]?.trail.map((t) => t.handoverId)).toEqual(['lodz', 'poznan', 'depot']);
  });

  it('skips earlier handovers that did not photograph the spot', () => {
    const [history] = damageHistory(
      [handover('gdynia'), handover('rail-yard', [], true), handover('lodz', [mark('m1')])],
      DEFAULT_DIMENSIONS,
    );
    expect(cellsUnderDent.length).toBeGreaterThan(0);
    expect(history).toMatchObject({ lastClear: 'gdynia', notInspectedAt: ['rail-yard'] });
  });

  it('has no clear handover for damage recorded at the first one', () => {
    const [history] = damageHistory([handover('gdynia', [mark('m1')])], DEFAULT_DIMENSIONS);
    expect(history?.lastClear).toBeNull();
  });

  it('treats records without coverage as having inspected everything', () => {
    const [history] = damageHistory(
      [{ id: 'old', marks: [] }, handover('lodz', [mark('m1')])],
      DEFAULT_DIMENSIONS,
    );
    expect(history?.lastClear).toBe('old');
  });
});
