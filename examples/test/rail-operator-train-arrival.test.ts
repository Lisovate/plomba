import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkerList,
  openArrivals,
  parseWagonList,
  planTrain,
  WagonListError,
} from '../rail-operator-train-arrival/train.ts';
import { PlombaApiError, PlombaClient } from '../shared/client.ts';
import { EXAMPLES, type Installation, installation, runCli } from './support.ts';

const SAMPLE = join(EXAMPLES, 'rail-operator-train-arrival', 'sample-train.csv');

/** Two good rows around four bad ones. */
const MIXED = `wagon,container,size_type,seals
33 51 4556 016-5,PLBU4000151,22G1,PL 0412390
33 51 4556 016-4,PLBU4000167,22G1,
33 51 4556 017-3,PLBU4000173,22G1,PL 0412391
33 51 4556 017-3,PLBU4000151,XX99,
3351455,PLBU 400018 8,45G1,
33 51 4556 017-3,plbu 400016 7,22G1,PL 0412392;PL 0412393
`;

const options = {
  place: 'Łódź inland terminal',
  checker: 'A. Nowak',
  handedOverBy: 'Vistula Rail',
};

describe('the wagon list', () => {
  it('passes every row of the sample train', async () => {
    const plan = planTrain(parseWagonList(await readFile(SAMPLE, 'utf8')));
    expect(plan.rejected).toEqual([]);
    expect(plan.planned).toHaveLength(8);
    expect(plan.planned[0]).toEqual({
      line: 2,
      wagon: '335145560124',
      container: 'PLBU4000070',
      sizeType: '45G1',
      seals: ['PL 0412380'],
    });
  });

  it('refuses all but the first row of the sample with errors', async () => {
    const file = join(EXAMPLES, 'rail-operator-train-arrival', 'sample-train-with-errors.csv');
    const plan = planTrain(parseWagonList(await readFile(file, 'utf8')));
    expect(plan.planned.map((p) => p.line)).toEqual([2]);
    expect(plan.rejected.map((r) => r.line)).toEqual([3, 4, 5, 6]);
  });

  it('refuses wrong check digits, unknown codes and repeated containers, with the line and the fix', () => {
    const plan = planTrain(parseWagonList(MIXED));
    expect(plan.planned.map((p) => [p.line, p.container, p.seals])).toEqual([
      [2, 'PLBU4000151', ['PL 0412390']],
      [7, 'PLBU4000167', ['PL 0412392', 'PL 0412393']],
    ]);
    expect(plan.rejected.map((r) => [r.line, r.problems])).toEqual([
      [3, ['wagon number 33 51 4556 016-4 fails the UIC check digit: it should end in 5']],
      [
        4,
        ['container number PLBU4000173 fails the ISO 6346 check digit: it should end in 2, not 3'],
      ],
      [
        5,
        [
          'container PLBU4000151 is already on line 2',
          '"XX99" is not an ISO 6346 size/type code (e.g. 22G1, 45G1)',
        ],
      ],
      [6, ['wagon number 3351455 must have 12 digits']],
    ]);
  });

  it('needs the named columns, in any order', () => {
    expect(() => parseWagonList('container,wagon\nPLBU4000151,335145560165\n')).toThrow(
      WagonListError,
    );
    const rows = parseWagonList('seals,size_type,container,wagon\n,,PLBU4000151,335145560165\n');
    expect(planTrain(rows).planned[0]?.container).toBe('PLBU4000151');
  });
});

describe('opening the train against Plomba', () => {
  let plomba: Installation;
  beforeAll(async () => {
    plomba = await installation();
  });
  afterAll(() => plomba.sandbox.close());

  it('opens a rail gate-in handover per container, with the wagon and the seals', async () => {
    const plan = planTrain(parseWagonList(await readFile(SAMPLE, 'utf8')));
    const arrivals = await openArrivals(plomba.client, plan, options);
    expect(arrivals.map((a) => a.status)).toEqual(Array(8).fill('opened'));

    const { handovers, container } = await plomba.client.containerHistory('PLBU4000090');
    expect(container.sizeTypeCode).toBe('42G1');
    expect(handovers).toHaveLength(1);
    expect(handovers[0]).toMatchObject({
      direction: 'in',
      status: 'open',
      place: 'Łódź inland terminal',
      checker: 'A. Nowak',
      handedOverBy: 'Vistula Rail',
      receivedBy: 'Łódź inland terminal',
      transportMode: 'rail',
      vehicleId: '335145560132',
      sealNumbers: ['PL 0412382', 'PL 0412383'],
    });

    const list = checkerList(plan, arrivals, {
      baseUrl: plomba.client.baseUrl,
      place: options.place,
      train: 'TR 41021',
    });
    expect(list).toContain('Train TR 41021 at Łódź inland terminal: 8 container(s) on 4 wagon(s)');
    expect(list).toContain('3. Wagon 33 51 4556 013-2  PLBU 400009 0 (42G1)');
    expect(list).toContain(`opened: ${plomba.sandbox.url}/handovers/${handovers[0]?.id}`);
  });

  it('reports containers that already have an open handover, and opens nothing twice', async () => {
    const plan = planTrain(parseWagonList(await readFile(SAMPLE, 'utf8')));
    const again = await openArrivals(plomba.client, plan, { ...options, checker: 'B. Kowalski' });
    expect(again.map((a) => a.status)).toEqual(Array(8).fill('already-open'));
    const first = again[0];
    expect(first?.status === 'already-open' && first.handover?.checker).toBe('A. Nowak');
    const { handovers } = await plomba.client.containerHistory('PLBU4000070');
    expect(handovers).toHaveLength(1);
  });

  it('opens the good rows of a list with bad ones, and registers nothing from the bad ones', async () => {
    const plan = planTrain(parseWagonList(MIXED));
    const arrivals = await openArrivals(plomba.client, plan, options);
    expect(arrivals.map((a) => [a.row.container, a.status])).toEqual([
      ['PLBU4000151', 'opened'],
      ['PLBU4000167', 'opened'],
    ]);
    // PLBU4000188 is valid, but its row had a wrong wagon number.
    await expect(plomba.client.containerHistory('PLBU4000188')).rejects.toMatchObject({
      status: 404,
    });
    const list = checkerList(plan, arrivals, { baseUrl: plomba.client.baseUrl, place: 'Łódź' });
    expect(list).toContain('Refused (correct the wagon list and run it again):');
    expect(list).toContain('  line 3: wagon number 33 51 4556 016-4 fails the UIC check digit');
  });

  it('stops at a refused API token rather than failing row by row', async () => {
    const plan = planTrain(parseWagonList(await readFile(SAMPLE, 'utf8')));
    const stranger = new PlombaClient({ baseUrl: plomba.sandbox.url, token: 'x'.repeat(32) });
    await expect(openArrivals(stranger, plan, options)).rejects.toBeInstanceOf(PlombaApiError);
  });
});

describe('the command line', () => {
  let plomba: Installation;
  beforeAll(async () => {
    plomba = await installation();
  });
  afterAll(() => plomba.sandbox.close());

  it('checks a list without opening anything on --dry-run', async () => {
    const result = await runCli(
      'rail-operator-train-arrival/main.ts',
      ['--wagons', SAMPLE, '--place', 'Łódź inland terminal', '--dry-run'],
      plomba.env,
    );
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('checked, not opened (dry run)');
    expect(await plomba.client.recentHandovers()).toEqual([]);
  });

  it('opens the train, and exits 1 when rows were refused', async () => {
    const file = join(tmpdir(), `plomba-train-${process.pid}.csv`);
    await writeFile(file, MIXED);
    const result = await runCli(
      'rail-operator-train-arrival/main.ts',
      ['--wagons', file, '--place', 'Łódź inland terminal', '--checker', 'A. Nowak'],
      plomba.env,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('2 container(s) on 2 wagon(s), 4 row(s) refused');
    expect(result.stdout.match(/opened: http/g)).toHaveLength(2);
  });

  it('explains a missing token', async () => {
    const result = await runCli(
      'rail-operator-train-arrival/main.ts',
      ['--wagons', SAMPLE, '--place', 'Łódź', '--checker', 'A. Nowak'],
      { PLOMBA_URL: plomba.sandbox.url, PLOMBA_API_TOKEN: '' },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('answered 401');
    expect(result.stderr).toContain('Set PLOMBA_API_TOKEN');
  });
});
