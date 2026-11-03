import { HandoverSearchSchema, type HandoverSummary, StartHandoverSchema } from '@plomba/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import type { HandoverSearchOptions } from '../src/ports.ts';
import { createTestHandoverService, makePhoto, markInput } from './fakes.ts';
import { handoverSearchFixture } from './handover-search-fixture.ts';

const ids = (handovers: readonly HandoverSummary[]) => handovers.map((h) => h.id);
const databases: { close(): void }[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function fixture() {
  const context = await handoverSearchFixture();
  databases.push(context.db);
  return context;
}

describe('handover repository search', () => {
  it('filters by vehicle, container, status, direction and exact place, separately and together', async () => {
    const f = await fixture();
    const cases: [Omit<HandoverSearchOptions, 'limit'>, string[]][] = [
      [{ vehicle: 'EL4K217' }, [f.openTruck.id, f.tiedB.id, f.tiedA.id, f.older.id]],
      [{ vehicle: '335145560124' }, [f.wagon.id]],
      [{ container: 'CSQU3054383' }, [f.openTruck.id, f.tiedA.id, f.older.id]],
      [{ status: 'open' }, [f.wagon.id, f.openTruck.id]],
      [{ status: 'closed' }, [f.otherTruck.id, f.tiedB.id, f.tiedA.id, f.older.id]],
      [{ direction: 'in' }, [f.wagon.id, f.openTruck.id, f.tiedA.id]],
      [{ direction: 'out' }, [f.otherTruck.id, f.tiedB.id, f.older.id]],
      [{ place: 'Gdynia' }, [f.otherTruck.id, f.openTruck.id, f.tiedB.id, f.older.id]],
      [{ place: 'gdynia' }, []],
      [{ place: 'Gdynia ' }, []],
      [{ place: "Gdynia' OR 1=1 --" }, []],
      [{ vehicle: '%' }, []],
      [
        {
          vehicle: 'EL4K217',
          container: 'CSQU3054383',
          status: 'closed',
          direction: 'out',
          place: 'Gdynia',
        },
        [f.older.id],
      ],
    ];
    for (const [filters, expected] of cases) {
      expect(ids(f.repository.search({ ...filters, limit: 100 })), JSON.stringify(filters)).toEqual(
        expected,
      );
    }
  });

  it('pages through ties without repeats when a new handover arrives', async () => {
    const f = await fixture();
    const first = f.repository.search({ limit: 4 });
    expect(ids(first)).toEqual(f.newestFirst.slice(0, 4));
    const last = first.at(-1);
    if (!last) throw new Error('Missing first page');
    f.service.registerContainer({ number: 'PLBU4000043' });
    f.service.start(
      StartHandoverSchema.parse({
        containerNumber: 'PLBU4000043',
        direction: 'in',
        place: 'Gdynia',
        checker: 'Gate checker',
      }),
    );
    const second = f.repository.search({
      limit: 4,
      after: { startedAt: last.startedAt, id: last.id },
    });
    expect([...ids(first), ...ids(second)]).toEqual(f.newestFirst);
    expect(
      f.repository.search({ limit: 4, after: { startedAt: f.older.startedAt, id: f.older.id } }),
    ).toEqual([]);
  });

  it('returns counts without rejected marks', async () => {
    const f = await fixture();
    await f.service.addPhoto(f.openTruck.id, { face: 'D', data: await makePhoto() });
    f.service.addMark(
      f.openTruck.id,
      markInput({ face: 'D', rect: { u0: 0, v0: 0, u1: 1, v1: 1 } }),
    );
    f.service.addMark(
      f.openTruck.id,
      markInput({ face: 'D', rect: { u0: 0, v0: 0, u1: 1, v1: 1 }, source: 'rejected' }),
    );
    expect(f.repository.search({ vehicle: 'EL4K217', status: 'open', limit: 1 })).toMatchObject([
      { id: f.openTruck.id, photoCount: 1, markCount: 1 },
    ]);
  });
});

describe('handover service search', () => {
  it('normalises vehicle and container filters and combines all filters', async () => {
    const f = await fixture();
    const cases = [
      [{ vehicle: 'el 4k-217' }, [f.openTruck.id, f.tiedB.id, f.tiedA.id, f.older.id]],
      [{ vehicle: '33 51-4556-0124' }, [f.wagon.id]],
      [{ container: 'csqu 305438-3' }, [f.openTruck.id, f.tiedA.id, f.older.id]],
      [{ status: 'open' }, [f.wagon.id, f.openTruck.id]],
      [{ status: 'closed' }, [f.otherTruck.id, f.tiedB.id, f.tiedA.id, f.older.id]],
      [{ direction: 'in' }, [f.wagon.id, f.openTruck.id, f.tiedA.id]],
      [{ direction: 'out' }, [f.otherTruck.id, f.tiedB.id, f.older.id]],
      [{ place: 'Łódź' }, [f.tiedA.id]],
      [{ place: 'łódź' }, []],
      [{ vehicle: 'unknown' }, []],
      [
        {
          vehicle: 'el-4k217',
          container: 'csqu 305438 3',
          status: 'closed',
          direction: 'out',
          place: 'Gdynia',
        },
        [f.older.id],
      ],
    ] as const;
    for (const [filters, expected] of cases) {
      expect(ids(f.service.search(filters).handovers), JSON.stringify(filters)).toEqual(expected);
    }
  });

  it('keeps filters across pages and excludes newer arrivals, including at a timestamp tie', async () => {
    const f = await fixture();
    const filters = { vehicle: 'el4k217', status: 'closed' as const, limit: 1 };
    const first = f.service.search(filters);
    expect(ids(first.handovers)).toEqual([f.tiedB.id]);
    expect(first.nextCursor).toBeTypeOf('string');
    await f.service.close(f.openTruck.id, { acceptGaps: true });
    f.service.start(
      StartHandoverSchema.parse({
        containerNumber: 'CSQU3054383',
        vehicleId: 'EL-4K217',
        direction: 'out',
        place: 'Gdynia',
        checker: 'Gate checker',
      }),
    );
    const second = f.service.search({ ...filters, cursor: first.nextCursor });
    expect(ids(second.handovers)).toEqual([f.tiedA.id]);
    const third = f.service.search({ ...filters, cursor: second.nextCursor });
    expect(ids(third.handovers)).toEqual([f.older.id]);
    expect(third.nextCursor).toBeUndefined();
  });

  it('defaults to 30 and accepts page sizes from 1 to 100', async () => {
    const { service, db } = createTestHandoverService();
    databases.push(db);
    service.registerContainer({ number: 'CSQU3054383' });
    for (let i = 0; i < 31; i++) {
      const handover = service.start(
        StartHandoverSchema.parse({
          containerNumber: 'CSQU3054383',
          direction: 'in',
          place: 'Gdynia',
          checker: 'Gate checker',
        }),
      );
      await service.close(handover.id, { acceptGaps: true });
    }
    expect(service.search().handovers).toHaveLength(30);
    expect(service.search().nextCursor).toBeTypeOf('string');
    expect(service.search({ limit: 1 }).handovers).toHaveLength(1);
    expect(service.search({ limit: '100' }).handovers).toHaveLength(31);
    expect(service.search({ limit: 100 }).nextCursor).toBeUndefined();
  });

  it('rejects invalid filters and cursor contents as validation errors', async () => {
    const f = await fixture();
    const invalid = [
      { vehicle: ' - ' },
      { container: 'CSQU3054384' },
      { container: 'not-a-container' },
      { cursor: 'not-a-cursor' },
      ...[
        {},
        [],
        { startedAt: 'yesterday', id: f.older.id },
        { startedAt: f.older.startedAt, id: 'invalid' },
      ].map((value) => ({ cursor: Buffer.from(JSON.stringify(value)).toString('base64url') })),
    ];
    for (const filters of invalid) expect(() => f.service.search(filters)).toThrow(ValidationError);
    expect(f.service.search({ container: 'PLBU4000043' }).handovers).toEqual([]);
  });

  it.each([0, 101, 1.5, 'bad', '', 'Infinity', 'NaN'])(
    'rejects invalid page size %s in the contract',
    (limit) => {
      expect(HandoverSearchSchema.safeParse({ limit }).success).toBe(false);
    },
  );
});
