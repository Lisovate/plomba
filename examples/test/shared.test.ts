import { StartHandoverSchema } from '@plomba/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PlombaApiError,
  PlombaClient,
  PlombaContractError,
  PlombaUnreachableError,
} from '../shared/client.ts';
import { parseCsv, toCsv } from '../shared/csv.ts';
import { type Installation, installation } from './support.ts';

describe('CSV', () => {
  it('reads quoted fields, doubled quotes, CRLF, a byte order mark and blank lines', () => {
    const text =
      '\uFEFFwagon,note\r\n\r\n335145560124,"bent, ""badly""\nat the door"\r\n335145560132,\n';
    expect(parseCsv(text)).toEqual([
      { line: 1, fields: ['wagon', 'note'] },
      { line: 3, fields: ['335145560124', 'bent, "badly"\nat the door'] },
      { line: 5, fields: ['335145560132', ''] },
    ]);
  });

  it('writes what it reads', () => {
    const rows = [
      ['container', 'codes'],
      ['PLBU4000043', 'RX5N DT; DX2N BT'],
      ['PLBU4000059', 'a "quoted", field'],
    ];
    const csv = toCsv(rows);
    expect(csv).toContain('"a ""quoted"", field"\r\n');
    expect(parseCsv(csv).map((r) => r.fields)).toEqual(rows);
  });
});

describe('the handover search client', () => {
  it('reads a page, resumes from its cursor and iterates through all matching pages', async () => {
    const plomba = await installation();
    try {
      const service = plomba.sandbox.handovers;
      service.registerContainer({ number: 'PLBU4000043' });
      const place = 'Łódź, gate & depot';
      const handovers = [];
      for (let i = 0; i < 5; i++) {
        const handover = service.start(
          StartHandoverSchema.parse({
            containerNumber: 'PLBU4000043',
            direction: 'out',
            place,
            checker: 'Gate checker',
            vehicleId: i === 2 ? 'OTHER' : 'EL-4K217',
            transportMode: 'road',
          }),
        );
        handovers.push(await service.close(handover.id, { acceptGaps: true }));
      }
      const filters = {
        vehicle: 'el 4k217',
        container: 'plbu 400004 3',
        status: 'closed' as const,
        direction: 'out' as const,
        place,
        limit: 2,
      };
      const expected = handovers
        .filter((h) => h.vehicleId !== 'OTHER')
        .reverse()
        .map((h) => h.id);
      const first = await plomba.client.searchHandovers(filters);
      expect(first.handovers.map((h) => h.id)).toEqual(expected.slice(0, 2));
      expect(first.nextCursor).toBeTypeOf('string');
      const second = await plomba.client.searchHandovers({ ...filters, cursor: first.nextCursor });
      expect(second.handovers.map((h) => h.id)).toEqual(expected.slice(2));
      expect(second.nextCursor).toBeUndefined();
      const all = [];
      for await (const handover of plomba.client.allHandovers(filters)) all.push(handover.id);
      expect(all).toEqual(expected);
      const remaining = [];
      for await (const handover of plomba.client.allHandovers({
        ...filters,
        cursor: first.nextCursor,
      }))
        remaining.push(handover.id);
      expect(remaining).toEqual(expected.slice(2));
      expect(await plomba.client.searchHandovers({ vehicle: 'UNKNOWN' })).toEqual({
        handovers: [],
      });
      await expect(plomba.client.searchHandovers({ cursor: 'invalid' })).rejects.toMatchObject({
        status: 400,
      });
    } finally {
      await plomba.sandbox.close();
    }
  });

  it('validates search responses against the contracts', async () => {
    const client = new PlombaClient({
      baseUrl: 'https://plomba.example.com',
      fetch: async () => Response.json([{ id: 'incomplete' }]),
    });
    await expect(client.searchHandovers({ vehicle: 'EL4K217' })).rejects.toBeInstanceOf(
      PlombaContractError,
    );
  });
});

describe('the API client', () => {
  let plomba: Installation;
  beforeAll(async () => {
    plomba = await installation();
  });
  afterAll(() => plomba.sandbox.close());

  it('turns problem details into PlombaApiError, with the status and the issues', async () => {
    const error = await plomba.client
      .registerContainer({ number: 'PLBU4000044' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlombaApiError);
    expect(error).toMatchObject({
      status: 400,
      problem: { title: 'PLBU4000044 is not a valid ISO 6346 container number' },
    });
    expect((error as Error).message).toContain('number: check-digit-mismatch');
  });

  it('sends the token as a bearer token, and is refused without one', async () => {
    const anonymous = new PlombaClient({ baseUrl: plomba.sandbox.url });
    await expect(anonymous.recentHandovers()).rejects.toMatchObject({ status: 401 });
    await expect(plomba.client.recentHandovers()).resolves.toEqual([]);
  });

  it('builds query strings and parses answers with the contracts', async () => {
    const seen: string[] = [];
    const client = new PlombaClient({
      baseUrl: 'https://plomba.example.com/',
      token: 'a-token-of-at-least-24-chars',
      fetch: async (url, init) => {
        seen.push(`${url} ${new Headers(init?.headers).get('authorization')}`);
        return Response.json([{ number: 'PLBU4000043' }]);
      },
    });
    const error = await client.listContainers({ owner: 'PLBU', limit: 5 }).catch((e: unknown) => e);
    expect(seen).toEqual([
      'https://plomba.example.com/api/containers?owner=PLBU&limit=5 Bearer a-token-of-at-least-24-chars',
    ]);
    // The answer lacks fields the contract requires: client and server disagree.
    expect(error).toBeInstanceOf(PlombaContractError);
    expect((error as Error).message).toContain('0.dimensions');
  });

  it('says when Plomba cannot be reached', async () => {
    const client = new PlombaClient({
      baseUrl: 'http://127.0.0.1:9',
      fetch: async () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
      },
    });
    await expect(client.recentHandovers()).rejects.toThrow(PlombaUnreachableError);
    await expect(client.recentHandovers()).rejects.toThrow('ECONNREFUSED');
  });
});
