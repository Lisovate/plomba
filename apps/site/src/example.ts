/**
 * The one example container the site's illustrations follow: four handovers
 * from Gdynia to Łódź, an old corrosion mark and a new dent. The codes, hashes
 * and the CODECO message come from Plomba's own core, so the examples are what
 * the app would produce. The handovers themselves are made up.
 */

import {
  buildCodeco,
  type ContainerDimensions,
  chainHash,
  DAMAGE_CODES,
  type DamageCode,
  type FaceRect,
  formatContainerNumber,
  GENESIS_HASH,
  locationCode,
  parseSizeType,
  type SectionLocation,
  sectionRect,
} from '@plomba/core';

// An illustration, not a container from the live demo.
const NUMBER = 'PLBU4000995';
const SIZE_TYPE = '42G1';

function dimensionsOf(code: string): ContainerDimensions {
  const sizeType = parseSizeType(code);
  if (!sizeType) throw new Error(`Unknown size/type code ${code}`);
  return sizeType.dimensions;
}

export const CONTAINER = {
  number: NUMBER,
  display: formatContainerNumber(NUMBER),
  sizeType: SIZE_TYPE,
  dimensions: dimensionsOf(SIZE_TYPE),
} as const;

export interface ExampleDamage {
  /** On the left side, as the checker would name it. */
  readonly rect: FaceRect;
  readonly location: string;
  readonly damage: DamageCode;
  readonly damageName: string;
  /** The handover that first recorded it. */
  readonly firstRecorded: number;
}

function leftSideDamage(
  section: SectionLocation,
  damage: DamageCode,
  firstRecorded: number,
): ExampleDamage {
  const rect = sectionRect('L', CONTAINER.dimensions, section);
  return {
    rect,
    location: locationCode('L', rect, CONTAINER.dimensions),
    damage,
    damageName: DAMAGE_CODES[damage],
    firstRecorded,
  };
}

/** Recorded at the first handover and still there since. */
export const CORROSION = leftSideDamage({ from: 7, to: 8, half: 'upper' }, 'CO', 1);

/** "Wgniecenie, lewy bok, sekcja trzecia, na dole": found at the fourth handover. */
export const DENT = leftSideDamage({ from: 3, to: 3, half: 'lower' }, 'DT', 4);

/** What each handover's photos showed of the spot where the dent is. */
export type SpotEvidence = 'clean' | 'not-photographed' | 'recorded';

export interface ExampleHandover {
  readonly sequence: number;
  readonly direction: 'in' | 'out';
  readonly place: string;
  readonly date: string;
  readonly transport: string;
  readonly dentSpot: SpotEvidence;
  readonly previousHash: string;
  readonly hash: string;
}

const HANDOVERS = [
  {
    direction: 'in',
    place: 'Gdynia rail terminal',
    date: '2026-10-28T09:12:00Z',
    transport: 'Truck GD 7K204',
    dentSpot: 'clean',
  },
  {
    direction: 'out',
    place: 'Gdynia rail terminal',
    date: '2026-10-29T17:40:00Z',
    transport: 'Wagon 21 81 2471 217-3',
    dentSpot: 'clean',
  },
  {
    direction: 'in',
    place: 'Łódź inland terminal',
    date: '2026-10-30T06:05:00Z',
    transport: 'Wagon 21 81 2471 217-3',
    dentSpot: 'not-photographed',
  },
  {
    direction: 'out',
    place: 'Łódź inland terminal',
    date: '2026-11-03T13:30:00Z',
    transport: 'Truck EL 4K217',
    dentSpot: 'recorded',
  },
] as const;

async function sealAll(): Promise<ExampleHandover[]> {
  const sealed: ExampleHandover[] = [];
  let previousHash = GENESIS_HASH;
  for (const [index, handover] of HANDOVERS.entries()) {
    const sequence = index + 1;
    const marks = [CORROSION, DENT]
      .filter((d) => d.firstRecorded <= sequence)
      .map(({ location, damage }) => ({ face: 'L', location, damage }));
    const hash = await chainHash(previousHash, {
      container: NUMBER,
      sequence,
      ...handover,
      marks,
    });
    sealed.push({ sequence, ...handover, previousHash, hash });
    previousHash = hash;
  }
  return sealed;
}

/** The container's sealed history, oldest first. */
export const EXAMPLE_HANDOVERS: readonly ExampleHandover[] = await sealAll();

export function eventName(handover: Pick<ExampleHandover, 'direction'>): string {
  return handover.direction === 'in' ? 'Gate in' : 'Gate out';
}

/** 30 Oct 2026 */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** The latest handover's CODECO gate-out message, as the app would send it. */
export function exampleCodeco(): string {
  const handover = EXAMPLE_HANDOVERS.at(-1);
  if (!handover) throw new Error('No example handovers');
  return buildCodeco({
    senderId: 'PLOMBA',
    recipientId: 'CARRIER',
    interchangeRef: handover.hash.slice(0, 14).toUpperCase(),
    documentNumber: `${NUMBER}-${handover.sequence}`,
    preparedAt: new Date(handover.date),
    direction: handover.direction,
    containerNumber: NUMBER,
    sizeTypeCode: SIZE_TYPE,
    movedAt: new Date(handover.date),
    place: { name: handover.place },
    sealNumbers: [],
    damages: [CORROSION, DENT].map((d) => ({
      locationCode: d.location,
      damageCode: d.damage,
      componentCode: 'PAA',
    })),
    recordHash: handover.hash,
    inlandTransport: { mode: 'road', reference: 'EL4K217' },
  });
}
