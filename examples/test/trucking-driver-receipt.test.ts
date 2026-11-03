import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StartHandoverSchema } from '@plomba/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Journey } from '../sandbox/journey.ts';
import { CONTAINER, OTHER_TRUCK, OTHER_TRUCK_CONTAINER, TRUCK } from '../sandbox/journey.ts';
import { PlombaClient } from '../shared/client.ts';
import {
  buildReceipt,
  driverReceipt,
  findLatestSealed,
  receiptHtml,
  receiptText,
} from '../trucking-driver-receipt/receipt.ts';
import { type Installation, installation, installationWithJourney, runCli } from './support.ts';

let plomba: Installation & { readonly journey: Journey };
beforeAll(async () => {
  plomba = await installationWithJourney();
});
afterAll(() => plomba.sandbox.close());

describe('finding the handover', () => {
  it("finds the truck's latest sealed handover, not its open one or another truck's", async () => {
    // EL 4K217 took PLBU 400004 3 out of Gdynia, brought it into Łódź (the latest sealed),
    // and has another container's gate in still open.
    const found = await findLatestSealed(plomba.client, { truck: 'el-4k-217' });
    expect(found?.id).toBe(plomba.journey.handovers.lodzIn.id);
    expect((await findLatestSealed(plomba.client, { truck: OTHER_TRUCK }))?.id).toBe(
      plomba.journey.handovers.otherTruck.id,
    );
  });

  it('restricts the search to the container when given', async () => {
    const found = await findLatestSealed(plomba.client, { truck: TRUCK, container: CONTAINER });
    expect(found?.id).toBe(plomba.journey.handovers.lodzIn.id);
    expect(
      await findLatestSealed(plomba.client, { truck: TRUCK, container: OTHER_TRUCK_CONTAINER }),
    ).toBeUndefined();
    expect(await findLatestSealed(plomba.client, { truck: 'WX 00000' })).toBeUndefined();
  });

  it('finds a sealed handover older than the latest 30 without a container', async () => {
    const older = await installation();
    try {
      const service = older.sandbox.handovers;
      service.registerContainer({ number: CONTAINER });
      const start = (vehicleId: string) =>
        service.start(
          StartHandoverSchema.parse({
            containerNumber: CONTAINER,
            direction: 'out',
            place: 'Gdynia',
            checker: 'Gate checker',
            transportMode: 'road',
            vehicleId,
          }),
        );
      const target = await service.close(start(TRUCK).id, { acceptGaps: true });
      for (let i = 0; i < 31; i++) await service.close(start(OTHER_TRUCK).id, { acceptGaps: true });
      expect((await older.client.recentHandovers()).some((h) => h.id === target.id)).toBe(false);
      expect((await findLatestSealed(older.client, { truck: 'el-4k217' }))?.id).toBe(target.id);
      expect((await driverReceipt(older.client, { truck: TRUCK }))?.record).toMatchObject({
        hash: target.seal?.hash,
        verified: true,
      });
    } finally {
      await older.sandbox.close();
    }
  });

  it('checks every page and chooses by seal time, even when started earlier', async () => {
    const earlier = plomba.journey.handovers.gdynia;
    const later = plomba.journey.handovers.lodzIn;
    const client = new PlombaClient({
      baseUrl: plomba.sandbox.url,
      fetch: async (input) => {
        const url = new URL(String(input));
        return url.searchParams.has('cursor')
          ? Response.json([
              { ...earlier, closedAt: '2099-01-01T00:00:00.000Z', markCount: 0, photoCount: 0 },
            ])
          : Response.json([{ ...later, markCount: 0, photoCount: 0 }], {
              headers: { Link: '</api/handovers?cursor=next>; rel="next"' },
            });
      },
    });
    expect((await findLatestSealed(client, { truck: TRUCK }))?.id).toBe(earlier.id);
  });
});

describe('the receipt', () => {
  it('holds the container, the gate, the damage on record and the verified hash', async () => {
    const receipt = await driverReceipt(plomba.client, { truck: TRUCK });
    const { lodzIn } = plomba.journey.handovers;
    expect(receipt).toMatchObject({
      container: { number: CONTAINER, sizeTypeCode: '42G1' },
      movement: 'gate in',
      leg: 'gate in, by road, truck EL 4K217',
      place: 'Łódź inland terminal',
      handedOverBy: 'Kociewie Trans',
      seals: ['PL 0412377'],
      record: { hash: lodzIn.seal?.hash, position: 2, chainLength: 3, verified: true },
      links: {
        receipt: `${plomba.sandbox.url}/handovers/${lodzIn.id}/report`,
        codeco: `${plomba.sandbox.url}/api/handovers/${lodzIn.id}/codeco`,
      },
    });
    expect(receipt?.damage).toEqual([
      {
        locationCode: plomba.journey.damage.rust.locationCode,
        damage: 'Corroded (CO)',
        component: 'Panel (PAA)',
        face: 'left side',
        status: 'already recorded',
        note: null,
      },
      {
        locationCode: plomba.journey.damage.dent.locationCode,
        damage: 'Dent (DT)',
        component: 'Panel (PAA)',
        face: 'right side',
        status: 'new',
        note: 'Dent about 30 cm across',
      },
    ]);
  });

  it('carries the same hash as the CODECO message', async () => {
    const receipt = await driverReceipt(plomba.client, { truck: TRUCK });
    const codeco = await plomba.client.codeco(plomba.journey.handovers.lodzIn.id, 'LINE');
    expect(codeco).toContain(`PLOMBA RECORD SHA-256:${receipt?.record.hash.toUpperCase()}`);
  });

  it("isn't marked verified when the chain doesn't hold the hash", async () => {
    const { lodzIn } = plomba.journey.handovers;
    const [detail, history] = await Promise.all([
      plomba.client.handover(lodzIn.id),
      plomba.client.containerHistory(CONTAINER),
    ]);
    const altered = {
      ...history,
      handovers: history.handovers.map((h) =>
        h.id === lodzIn.id && h.seal ? { ...h, seal: { ...h.seal, hash: 'f'.repeat(64) } } : h,
      ),
    };
    expect(buildReceipt(detail, altered, plomba.sandbox.url).record.verified).toBe(false);
    const broken = { ...history, chain: { ok: false, length: 3, brokenAt: 1 } };
    const receipt = buildReceipt(detail, broken, plomba.sandbox.url);
    expect(receiptText(receipt)).toContain('WARNING: the chain did not verify');
  });

  it('reads as text with the hash and how to check it, and as escaped HTML', async () => {
    const receipt = await driverReceipt(plomba.client, { truck: TRUCK });
    if (!receipt) throw new Error('No receipt');
    const text = receiptText(receipt);
    expect(text).toContain('GATE IN RECEIPT  PLBU 400004 3 (42G1)');
    expect(text).toContain(`SHA-256   ${receipt.record.hash}`);
    expect(text).toContain('handover 2 must carry this hash');

    const html = receiptHtml({
      ...receipt,
      damage: receipt.damage.map((d) => ({ ...d, note: '<script>alert(1)</script>' })),
    });
    expect(html).toContain('<h1>Gate in receipt: PLBU 400004 3 (42G1)</h1>');
    expect(html).toContain(`<code>${receipt.record.hash}</code>`);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('the command line', () => {
  it('prints the receipt', async () => {
    const result = await runCli(
      'trucking-driver-receipt/main.ts',
      ['--truck', 'EL 4K217'],
      plomba.env,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(plomba.journey.handovers.lodzIn.seal?.hash ?? 'missing');
    expect(result.stdout).toContain('Checked when this receipt was made: the chain verifies');
  });

  it('writes it as HTML', async () => {
    const file = join(tmpdir(), `plomba-receipt-${process.pid}.html`);
    const result = await runCli(
      'trucking-driver-receipt/main.ts',
      ['--truck', 'EL4K217', '--container', CONTAINER, '--html', file],
      plomba.env,
    );
    expect(result).toMatchObject({ code: 0, stdout: `Wrote ${file}\n` });
    expect(await readFile(file, 'utf8')).toContain('Gate in receipt');
  });

  it('says so when the truck has no sealed handover', async () => {
    const result = await runCli(
      'trucking-driver-receipt/main.ts',
      ['--truck', 'WX 00000'],
      plomba.env,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No sealed handover with truck WX 00000.');
  });
});
