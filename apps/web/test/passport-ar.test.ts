import type { ContainerHistory, DamageHistory, Handover } from '@plomba/contracts';
import { DEFAULT_DIMENSIONS } from '@plomba/core';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.ts';
import { format, type Translate } from '../src/i18n/index.tsx';
import { pl } from '../src/i18n/pl.ts';
import {
  describeSizeType,
  firstRecordedLabel,
  informationLines,
  openDamageInView,
} from '../src/lib/passport-ar.ts';

const t: Translate = (key, vars) => format(en[key], vars);
const polish: Translate = (key, vars) => format(pl[key], vars);

function handover(id: string, place: string, startedAt: string): Handover {
  return {
    id,
    place,
    startedAt,
    containerNumber: 'CSQU3054383',
    direction: 'in',
    checker: 'Checker',
    handedOverBy: null,
    receivedBy: null,
    sealNumbers: [],
    transportMode: null,
    vehicleId: null,
    status: 'closed',
    closedAt: startedAt,
    previousHandoverId: null,
    seal: { sequence: 0, previousHash: 'a'.repeat(64), hash: 'b'.repeat(64) },
  };
}

function damage(
  id: string,
  face: DamageHistory['face'],
  status: DamageHistory['status'],
): DamageHistory {
  return {
    id,
    face,
    status,
    rect: { u0: 1, v0: 0.2, u1: 2, v1: 0.5 },
    locationCode: 'LB2N',
    damageCode: 'DT',
    firstRecorded: 'first',
    lastClear: null,
    notInspectedAt: [],
    recordedNearbyAt: null,
    trail: [],
  };
}

function history(): ContainerHistory {
  return {
    container: {
      number: 'CSQU3054383',
      sizeTypeCode: '42G1',
      dimensions: DEFAULT_DIMENSIONS,
      createdAt: '2026-11-01T12:00:00Z',
    },
    // Deliberately not in date order: an API's ordering must not change the last handover shown.
    handovers: [
      { ...handover('last', 'Łódź', '2026-11-04T12:00:00Z'), direction: 'out' },
      handover('first', 'Gdynia', '2026-11-02T12:00:00Z'),
    ],
    chain: { ok: true, length: 2, brokenAt: null },
    damage: [
      damage('open-left', 'L', 'still-there'),
      damage('fixed-left', 'L', 'repaired'),
      damage('changed-right', 'R', 'changed'),
      damage('new-doors', 'D', 'new'),
    ],
  };
}

describe('openDamageInView', () => {
  it('keeps open damage only on the faces currently in view, including both faces of a corner', () => {
    expect(openDamageInView(history(), ['L']).map((d) => d.id)).toEqual(['open-left']);
    expect(openDamageInView(history(), ['R', 'D']).map((d) => d.id)).toEqual([
      'changed-right',
      'new-doors',
    ]);
    expect(openDamageInView(history(), [])).toEqual([]);
  });

  it('never presents a broken chain as a trustworthy damage passport', () => {
    const broken = { ...history(), chain: { ok: false, length: 2, brokenAt: 0 } };
    expect(openDamageInView(broken, ['L', 'R', 'D'])).toEqual([]);
  });
});

describe('describeSizeType', () => {
  it('describes the ISO length, type and high cube in the chosen language', () => {
    expect(describeSizeType('42G1', t)).toBe('42G1 · 40 ft general purpose');
    expect(describeSizeType('45R1', t)).toBe('45R1 · 40 ft refrigerated · high cube');
    expect(describeSizeType('22G1', polish)).toBe('22G1 · 20 ft ogólnego przeznaczenia');
  });

  it('preserves an unknown code and does not invent a size when none is recorded', () => {
    expect(describeSizeType('XXXX', t)).toBe('XXXX');
    expect(describeSizeType(null, t)).toBe('Size and type unknown');
  });
});

describe('informationLines', () => {
  it('shows the owner code, latest handover and verification of the sealed records', () => {
    expect(informationLines(history(), t, 'en')).toEqual({
      sizeType: '42G1 · 40 ft general purpose',
      owner: 'Owner code: CSQ',
      lastHandover: 'Last: Łódź · Gate out · Nov 4, 2026',
      chain: 'Sealed records verified: 2',
    });
  });

  it('distinguishes a broken chain from one with no sealed records', () => {
    const h = history();
    expect(
      informationLines({ ...h, chain: { ok: false, length: 2, brokenAt: 1 } }, t, 'en').chain,
    ).toBe('Broken record chain');
    const empty = informationLines(
      { ...h, handovers: [], chain: { ok: true, length: 0, brokenAt: null } },
      t,
      'en',
    );
    expect(empty.chain).toBe('No sealed records yet');
    expect(empty.lastHandover).toBe('No handovers recorded');
  });

  it('localizes the handover direction and dates', () => {
    const lines = informationLines(history(), polish, 'pl');
    expect(lines.owner).toBe('Kod właściciela: CSQ');
    expect(lines.lastHandover).toContain('Łódź');
    expect(lines.lastHandover).toContain(polish('handover.out'));
    expect(lines.lastHandover).toContain(
      new Date('2026-11-04T12:00:00Z').toLocaleDateString('pl', { dateStyle: 'medium' }),
    );
  });
});

describe('firstRecordedLabel', () => {
  it('uses the first recorded handover’s place and date, rather than the most recent sighting', () => {
    const h = history();
    expect(firstRecordedLabel(damage('dent', 'L', 'still-there'), h.handovers, t, 'en')).toBe(
      'First: Gdynia · Nov 2, 2026',
    );
  });

  it('does not make up an origin when the referenced handover is unavailable', () => {
    expect(firstRecordedLabel(damage('dent', 'L', 'new'), [], t, 'en')).toBe(
      'First recording unavailable',
    );
  });
});
