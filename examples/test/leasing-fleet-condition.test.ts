import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conditionOf,
  fleetCsv,
  fleetMarkdown,
  fleetReport,
} from '../leasing-fleet-condition/fleet.ts';
import { compareLease, LeaseError, leaseMarkdown } from '../leasing-fleet-condition/lease.ts';
import { CONTAINER, type Journey, OPEN_CONTAINER } from '../sandbox/journey.ts';
import { parseCsv } from '../shared/csv.ts';
import { type Installation, installationWithJourney, runCli } from './support.ts';

let plomba: Installation & { readonly journey: Journey };
beforeAll(async () => {
  plomba = await installationWithJourney();
});
afterAll(() => plomba.sandbox.close());

describe('the fleet report', () => {
  it("lists the owner's containers with open and repaired damage and the chain's state", async () => {
    const report = await fleetReport(plomba.client, 'plbu');
    expect(report.owner).toBe('PLBU');
    expect(report.truncated).toBe(false);
    expect(report.containers.map((c) => [c.number, c.chain, c.sealed])).toEqual([
      ['PLBU4000064', 'none', 0],
      ['PLBU4000059', 'verified', 1],
      ['PLBU4000043', 'verified', 3],
    ]);

    const leased = report.containers.find((c) => c.number === CONTAINER);
    const { rust, dent, lockingBar, secondDent, roofHole } = plomba.journey.damage;
    expect(leased?.damage?.open.map((d) => [d.id, d.description, d.status])).toEqual([
      [dent.id, 'Dent (DT), right side', 'still-there'],
      [lockingBar.id, 'Bent (BT), door end', 'new'],
      [secondDent.id, 'Dent (DT), right side', 'new'],
      [roofHole.id, 'Holed (HO), roof', 'new'],
    ]);
    expect(leased?.damage?.repaired.map((d) => [d.id, d.firstRecorded?.place])).toEqual([
      [rust.id, 'Gdynia container terminal'],
    ]);
    expect(leased?.lastHandover).toMatchObject({
      id: plomba.journey.handovers.lodzOut.id,
      leg: 'gate out, by rail, wagon 33 51 4556 012-4',
      status: 'closed',
    });
    const open = report.containers.find((c) => c.number === OPEN_CONTAINER);
    expect(open).toMatchObject({ chain: 'none', damage: { open: [], repaired: [] } });
    expect(open?.lastHandover?.status).toBe('open');
  });

  it('writes one CSV line per container, and Markdown for people', async () => {
    const report = await fleetReport(plomba.client, 'PLBU');
    const [head, ...rows] = parseCsv(fleetCsv(report)).map((r) => r.fields);
    expect(head?.slice(0, 9)).toEqual([
      'container',
      'size_type',
      'handovers',
      'sealed',
      'chain',
      'open_damage',
      'open_codes',
      'repaired_damage',
      'repaired_codes',
    ]);
    const { dent, lockingBar, rust } = plomba.journey.damage;
    const leased = rows.find((r) => r[0] === CONTAINER);
    expect(leased?.slice(0, 7)).toEqual([
      CONTAINER,
      '42G1',
      '3',
      '3',
      'verified',
      '4',
      expect.stringContaining(`${dent.locationCode} DT; ${lockingBar.locationCode} BT`),
    ]);
    expect(leased?.[8]).toBe(`${rust.locationCode} CO`);

    const markdown = fleetMarkdown(report);
    expect(markdown).toContain('# Fleet condition: PLBU');
    expect(markdown).toContain('3 container(s), 1 with open damage.');
    expect(markdown).toContain('| PLBU 400004 3 | 42G1 | verified | 4 | 1 |');
    expect(markdown).toContain('## PLBU 400004 3');
  });

  it('calls the damage unknown, not absent, when the chain is broken', async () => {
    const [summary] = await plomba.client.listContainers({ owner: 'PLBU', limit: 500 });
    const history = await plomba.client.containerHistory(CONTAINER);
    if (!summary) throw new Error('No containers');
    // What Plomba returns for a tampered record: no damage, and where the chain breaks.
    const tampered = { ...history, chain: { ok: false, length: 3, brokenAt: 1 }, damage: [] };
    const condition = conditionOf(summary, tampered, plomba.sandbox.url);
    expect(condition).toMatchObject({ chain: 'broken', brokenAt: 2, damage: null });
    const report = { owner: 'PLBU', generatedAt: '', containers: [condition], truncated: false };
    expect(fleetCsv(report)).toContain(',broken at 2,,unknown,,unknown,');
    expect(fleetMarkdown(report)).toContain('The hash chain breaks at record 2');
  });
});

describe('on-hire to off-hire', () => {
  it('charges only the damage first recorded between the two handovers', async () => {
    const history = await plomba.client.containerHistory(CONTAINER);
    const { gdynia, lodzIn } = plomba.journey.handovers;
    const lease = compareLease(history, gdynia.id, lodzIn.id);
    const { dent, rust } = plomba.journey.damage;
    expect(lease.chargeable.map((i) => i.damageId)).toEqual([dent.id]);
    expect(lease.chargeable[0]).toMatchObject({
      lastClear: { id: gdynia.id, place: 'Gdynia container terminal', position: 1 },
      firstRecorded: { id: lodzIn.id, recordHash: lodzIn.seal?.hash, position: 2 },
    });
    expect(lease.atOnHire.map((i) => i.damageId)).toEqual([rust.id]);
    // The locking bar, second dent and roof hole came after the off-hire.
    expect(lease.forReview).toEqual([]);
    expect(lease.repairedDuringLease).toEqual([]);
  });

  it('charges what was clean during the lease, and reviews what the records can’t pin to it', async () => {
    const history = await plomba.client.containerHistory(CONTAINER);
    const { gdynia, lodzIn, lodzOut } = plomba.journey.handovers;
    const { dent, lockingBar, secondDent, roofHole, rust } = plomba.journey.damage;
    const lease = compareLease(history, gdynia.id, lodzOut.id);
    expect(lease.chargeable.map((i) => [i.damageId, i.lastClear?.id, i.firstRecorded.id])).toEqual([
      [dent.id, gdynia.id, lodzIn.id],
      [lockingBar.id, lodzIn.id, lodzOut.id],
    ]);
    expect(lease.forReview.map((i) => [i.damageId, i.reason])).toEqual([
      [secondDent.id, expect.stringContaining('already recorded on this spot at Łódź')],
      [roofHole.id, 'no handover photographed this spot clean'],
    ]);
    expect(lease.atOnHire.map((i) => i.damageId)).toEqual([rust.id]);

    const markdown = leaseMarkdown(lease);
    expect(markdown).toContain('## Chargeable to the lessee (2)');
    expect(markdown).toContain(`\`${gdynia.seal?.hash}\``);
  });

  it('quotes the codes on record at off-hire, even after a later handover re-codes the damage', async () => {
    const history = await plomba.client.containerHistory(CONTAINER);
    const { gdynia, lodzIn, lodzOut } = plomba.journey.handovers;
    const dent = history.damage.find((d) => d.id === plomba.journey.damage.dent.id);
    if (!dent) throw new Error('No dent');
    const recordedAtOffHire = { locationCode: dent.locationCode, damageCode: dent.damageCode };
    // After the lease, the next handover records the same damage as a hole further along.
    const recoded = {
      ...history,
      damage: [
        {
          ...dent,
          locationCode: 'RB4N',
          damageCode: 'HO',
          trail: [
            ...dent.trail,
            {
              handoverId: lodzOut.id,
              markId: 'later',
              status: 'changed' as const,
              locationCode: 'RB4N',
              damageCode: 'HO',
            },
          ],
        },
      ],
    };
    const lease = compareLease(recoded, gdynia.id, lodzIn.id);
    expect(lease.chargeable).toHaveLength(1);
    expect(lease.chargeable[0]).toMatchObject(recordedAtOffHire);
  });

  it('counts damage repaired by off-hire as repaired during the lease', async () => {
    const history = await plomba.client.containerHistory(CONTAINER);
    const { gdynia, lodzIn, lodzOut } = plomba.journey.handovers;
    // As if the rust had first been recorded at the gate in, then repaired by the gate out.
    const rust = history.damage.find((d) => d.id === plomba.journey.damage.rust.id);
    if (!rust) throw new Error('No rust');
    const moved = {
      ...history,
      damage: [
        { ...rust, firstRecorded: lodzIn.id, lastClear: gdynia.id, trail: rust.trail.slice(1) },
      ],
    };
    const lease = compareLease(moved, gdynia.id, lodzOut.id);
    expect(lease.repairedDuringLease.map((i) => i.damageId)).toEqual([rust.id]);
    expect(lease.chargeable).toEqual([]);
  });

  it('refuses handovers in the wrong order, unsealed or unknown, and a broken chain', async () => {
    const history = await plomba.client.containerHistory(CONTAINER);
    const { gdynia, lodzIn, stillOpen } = plomba.journey.handovers;
    expect(() => compareLease(history, lodzIn.id, gdynia.id)).toThrow('must come after');
    expect(() => compareLease(history, gdynia.id, stillOpen.id)).toThrow(LeaseError);
    const open = await plomba.client.containerHistory(OPEN_CONTAINER);
    expect(() => compareLease(open, stillOpen.id, stillOpen.id)).toThrow('is not sealed yet');
    const broken = { ...history, chain: { ok: false, length: 3, brokenAt: 0 } };
    expect(() => compareLease(broken, gdynia.id, lodzIn.id)).toThrow('breaks at record 1');
  });
});

describe('the command line', () => {
  it('writes the fleet report as CSV and Markdown', async () => {
    const out = join(tmpdir(), `plomba-fleet-${process.pid}`);
    const result = await runCli(
      'leasing-fleet-condition/main.ts',
      ['fleet', '--owner', 'PLBU', '--out', out],
      plomba.env,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('3 container(s) with owner code PLBU: 1 with open damage');
    expect(await readFile(join(out, 'fleet-PLBU.csv'), 'utf8')).toMatch(/^container,size_type,/);
    expect(await readFile(join(out, 'fleet-PLBU.md'), 'utf8')).toContain('# Fleet condition');
  });

  it('prints the off-hire statement, as Markdown or JSON', async () => {
    const { gdynia, lodzIn } = plomba.journey.handovers;
    const args = [
      'lease',
      '--container',
      CONTAINER,
      '--on-hire',
      gdynia.id,
      '--off-hire',
      lodzIn.id,
    ];
    const markdown = await runCli('leasing-fleet-condition/main.ts', args, plomba.env);
    expect(markdown.code).toBe(0);
    expect(markdown.stdout).toContain('## Chargeable to the lessee (1)');
    const json = await runCli('leasing-fleet-condition/main.ts', [...args, '--json'], plomba.env);
    expect(JSON.parse(json.stdout).chargeable[0].damageId).toBe(plomba.journey.damage.dent.id);
  });

  it('explains a wrong pair of handovers, and an unknown command', async () => {
    const { gdynia, lodzIn } = plomba.journey.handovers;
    const reversed = await runCli(
      'leasing-fleet-condition/main.ts',
      ['lease', '--container', CONTAINER, '--on-hire', lodzIn.id, '--off-hire', gdynia.id],
      plomba.env,
    );
    expect(reversed).toMatchObject({ code: 1, stdout: '' });
    expect(reversed.stderr).toContain('must come after');
    const unknown = await runCli('leasing-fleet-condition/main.ts', ['report'], plomba.env);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown command report');
  });
});
