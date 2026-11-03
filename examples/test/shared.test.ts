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
