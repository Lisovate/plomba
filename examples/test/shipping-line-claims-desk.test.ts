import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type WebhookEvent, WebhookEventSchema } from '@plomba/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sign } from '../../apps/server/src/adapters/webhooks.ts';
import { describeHandoverEvent } from '../../apps/server/src/services/events.ts';
import { CONTAINER, type Journey, recordJourney } from '../sandbox/journey.ts';
import { buildClaims, type Claim } from '../shipping-line-claims-desk/claims.ts';
import { type ClaimsDesk, createClaimsDesk } from '../shipping-line-claims-desk/receiver.ts';
import { verifySignature } from '../shipping-line-claims-desk/signature.ts';
import { type Installation, installation, installationWithJourney, startCli } from './support.ts';

const SECRET = 'claims-desk-webhook-secret';
const now = () => Math.floor(Date.now() / 1000);

describe('the signature check', () => {
  const body = Buffer.from('{"type":"handover.sealed"}');

  it('accepts what Plomba signs, and nothing else', () => {
    const header = sign(SECRET, now(), body.toString());
    expect(verifySignature(SECRET, header, body)).toMatchObject({ ok: true });
    expect(verifySignature('another-secret-entirely', header, body)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(verifySignature(SECRET, header, Buffer.from(`${body} `))).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('refuses a correctly signed delivery replayed later', () => {
    const header = sign(SECRET, now() - 600, body.toString());
    expect(verifySignature(SECRET, header, body)).toEqual({ ok: false, reason: 'stale' });
    expect(verifySignature(SECRET, header, body, { toleranceSeconds: 900 })).toMatchObject({
      ok: true,
    });
  });

  it('refuses a missing or malformed header, and takes either of two signatures', () => {
    expect(verifySignature(SECRET, undefined, body)).toEqual({ ok: false, reason: 'missing' });
    expect(verifySignature(SECRET, 'v1=abc', body)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifySignature(SECRET, `t=${now()}`, body)).toEqual({ ok: false, reason: 'malformed' });
    const t = now();
    const good = sign(SECRET, t, body.toString()).split('v1=')[1];
    const rotating = `t=${t},v1=${'0'.repeat(64)},v1=${good}`;
    expect(verifySignature(SECRET, rotating, body)).toMatchObject({ ok: true });
  });
});

/** A claims desk listening on a free port. */
async function listeningDesk(plomba: Installation | undefined, outDir: string) {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/plomba`;
  const attach = (installation: Installation) => {
    const desk = createClaimsDesk({
      secret: SECRET,
      outDir,
      plomba: installation.client,
      log: () => {},
    });
    server.on('request', desk.handle);
    return desk;
  };
  return { server, url, attach, desk: plomba ? attach(plomba) : undefined };
}

const closeServer = (server: Server) => new Promise<void>((done) => server.close(() => done()));

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as unknown;

describe('webhooks delivered by Plomba', () => {
  let plomba: Installation & { readonly journey: Journey };
  let desk: ClaimsDesk;
  let server: Server;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'plomba-claims-'));
    // The desk listens first, so Plomba can be told where to send its webhooks; it
    // handles them once it has a client for Plomba, before anything is recorded.
    const listening = await listeningDesk(undefined, outDir);
    server = listening.server;
    const installed = await installation({
      webhooks: { urls: [listening.url], secret: SECRET, retryDelaysMs: [10, 10, 10] },
    });
    desk = listening.attach(installed);
    plomba = { ...installed, journey: await recordJourney(installed.client) };
    await plomba.sandbox.deliveries();
    await desk.idle();
  });
  afterAll(async () => {
    await plomba.sandbox.close();
    await closeServer(server);
  });

  it('processes each sealed handover once, and ignores started ones', () => {
    const { gdynia, lodzIn, lodzOut, otherTruck } = plomba.journey.handovers;
    expect(desk.processed.map((p) => p.handoverId).sort()).toEqual(
      [gdynia.id, lodzIn.id, lodzOut.id, otherTruck.id].sort(),
    );
  });

  it('opens a claim for damage that appeared between two handovers, with the evidence', async () => {
    const { dent } = plomba.journey.damage;
    const { gdynia, lodzIn } = plomba.journey.handovers;
    const claim = (await readJson(join(outDir, 'claims', `${CONTAINER}-${dent.id}.json`))) as Claim;
    expect(claim).toMatchObject({
      kind: 'claim',
      container: { number: CONTAINER, sizeTypeCode: '42G1' },
      damage: {
        id: dent.id,
        face: 'R',
        locationCode: dent.locationCode,
        damageCode: 'DT',
        componentCode: 'PAA',
        description: 'Dent (DT), Panel (PAA), right side',
        note: 'Dent about 30 cm across',
      },
      lastClear: {
        id: gdynia.id,
        place: 'Gdynia container terminal',
        leg: 'gate out, by road, truck EL 4K217',
        startedAt: gdynia.startedAt,
        recordHash: gdynia.seal?.hash,
        chainPosition: 1,
        links: {
          receipt: `${plomba.sandbox.url}/handovers/${gdynia.id}/report`,
          codeco: `${plomba.sandbox.url}/api/handovers/${gdynia.id}/codeco`,
        },
      },
      firstRecorded: {
        id: lodzIn.id,
        place: 'Łódź inland terminal',
        leg: 'gate in, by road, truck EL 4K217',
        recordHash: lodzIn.seal?.hash,
        chainPosition: 2,
      },
      notInspectedBetween: [],
      custody: ['Kociewie Trans'],
      chain: { verified: true },
    });

    const letter = await readFile(join(outDir, 'claims', `${CONTAINER}-${dent.id}.md`), 'utf8');
    expect(letter).toContain('| To | Kociewie Trans |');
    expect(letter).toContain('in the custody of Kociewie Trans');
    expect(letter).toContain(`\`${gdynia.seal?.hash}\``);
    expect(letter).toContain(`\`${lodzIn.seal?.hash}\``);
  });

  it('files for review what the records can’t settle, and opens no claim for it', async () => {
    const { lockingBar, secondDent, roofHole } = plomba.journey.damage;
    const { lodzIn, lodzOut } = plomba.journey.handovers;
    expect((await readdir(join(outDir, 'claims'))).sort()).toEqual(
      [
        `${CONTAINER}-${plomba.journey.damage.dent.id}.json`,
        `${CONTAINER}-${plomba.journey.damage.dent.id}.md`,
        `${CONTAINER}-${lockingBar.id}.json`,
        `${CONTAINER}-${lockingBar.id}.md`,
      ].sort(),
    );
    // The locking bar was clean at the gate in and found at the gate out: the terminal had it.
    const bar = (await readJson(
      join(outDir, 'claims', `${CONTAINER}-${lockingBar.id}.json`),
    )) as Claim;
    expect(bar).toMatchObject({ lastClear: { id: lodzIn.id }, custody: ['Łódź inland terminal'] });

    const nearby = await readJson(join(outDir, 'review', `${CONTAINER}-${secondDent.id}.json`));
    expect(nearby).toMatchObject({
      kind: 'review',
      reason: 'recorded-nearby',
      handover: { id: lodzOut.id },
      related: [{ id: lodzIn.id }],
    });
    const roof = await readJson(join(outDir, 'review', `${CONTAINER}-${roofHole.id}.json`));
    expect(roof).toMatchObject({ reason: 'not-inspected', related: [{}, {}] });
    expect(
      await readFile(join(outDir, 'review', `${CONTAINER}-${roofHole.id}.md`), 'utf8'),
    ).toContain('No earlier photo of the spot');

    const atGateOut = desk.processed.find((p) => p.handoverId === lodzOut.id);
    expect(atGateOut?.decision.skipped.map((s) => s.damageId).sort()).toEqual(
      [plomba.journey.damage.rust.id, plomba.journey.damage.dent.id].sort(),
    );
  });
});

describe('deliveries the desk must refuse or skip', () => {
  let plomba: Installation & { readonly journey: Journey };
  let desk: ClaimsDesk;
  let server: Server;
  let url: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'plomba-claims-'));
    plomba = await installationWithJourney();
    const listening = await listeningDesk(plomba, outDir);
    ({ server, url } = listening);
    desk = listening.desk as ClaimsDesk;
  });
  afterAll(async () => {
    await plomba.sandbox.close();
    await closeServer(server);
  });

  /** The real payload of the gate in at Łódź, as the server builds it. */
  const sealedEvent = async (): Promise<WebhookEvent> =>
    WebhookEventSchema.parse(
      await describeHandoverEvent(
        plomba.sandbox.handovers,
        {
          type: 'handover.sealed',
          handoverId: plomba.journey.handovers.lodzIn.id,
          containerNumber: CONTAINER,
          occurredAt: new Date().toISOString(),
        },
        { id: randomUUID(), publicUrl: plomba.sandbox.url },
      ),
    );

  const deliver = (body: string, headers: Record<string, string>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });

  const signed = (event: WebhookEvent, signedAt = now()) => {
    const body = JSON.stringify(event);
    return {
      body,
      headers: {
        'plomba-event': event.type,
        'plomba-delivery': event.id,
        'plomba-signature': sign(SECRET, signedAt, body),
      },
    };
  };

  it('accepts a signed handover.sealed at once and opens the claim', async () => {
    const event = await sealedEvent();
    const { body, headers } = signed(event);
    const response = await deliver(body, headers);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'accepted' });
    await desk.idle();
    const { dent } = plomba.journey.damage;
    expect(await readdir(join(outDir, 'claims'))).toContain(`${CONTAINER}-${dent.id}.json`);
  });

  it('skips a second delivery of the same event', async () => {
    const event = await sealedEvent();
    const first = signed(event);
    expect((await deliver(first.body, first.headers)).status).toBe(202);
    await desk.idle();
    const processed = desk.processed.length;
    // A retry: the same event id, signed afresh.
    const retry = signed(event);
    const response = await deliver(retry.body, retry.headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'duplicate' });
    await desk.idle();
    expect(desk.processed).toHaveLength(processed);
  });

  it('refuses a bad signature and an old timestamp', async () => {
    const event = await sealedEvent();
    const { body, headers } = signed(event);
    const forged = await deliver(body, {
      ...headers,
      'plomba-signature': sign('not-the-webhook-secret', now(), body),
    });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: 'Signature mismatch' });

    const tampered = await deliver(body.replace('Łódź', 'Lodz'), headers);
    expect(tampered.status).toBe(401);

    const replayed = signed(event, now() - 3600);
    const stale = await deliver(replayed.body, replayed.headers);
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: 'Signature stale' });

    const unsigned = await deliver(body, { 'plomba-delivery': event.id });
    expect(unsigned.status).toBe(401);

    // None of them counted as received: the genuine delivery still goes through.
    expect((await deliver(body, signed(event).headers)).status).toBe(202);
    await desk.idle();
  });

  it('refuses a delivery id that is not the signed event id, and bodies that are not events', async () => {
    const event = await sealedEvent();
    const { body, headers } = signed(event);
    const swapped = await deliver(body, { ...headers, 'plomba-delivery': randomUUID() });
    expect(swapped.status).toBe(400);

    const notAnEvent = '{"hello":"world"}';
    const response = await deliver(notAnEvent, {
      'plomba-signature': sign(SECRET, now(), notAnEvent),
    });
    expect(response.status).toBe(400);
    expect((await fetch(url)).status).toBe(405);
  });

  it('acknowledges handover.started without processing it', async () => {
    const started = { ...(await sealedEvent()), type: 'handover.started' as const, damage: [] };
    const { body, headers } = signed(started);
    const processed = desk.processed.length;
    const response = await deliver(body, headers);
    expect(await response.json()).toEqual({ status: 'ignored' });
    await desk.idle();
    expect(desk.processed).toHaveLength(processed);
  });
});

describe('deciding without the network', () => {
  let plomba: Installation & { readonly journey: Journey };
  beforeAll(async () => {
    plomba = await installationWithJourney();
  });
  afterAll(() => plomba.sandbox.close());

  const eventFor = async (handoverId: string) =>
    WebhookEventSchema.parse(
      await describeHandoverEvent(
        plomba.sandbox.handovers,
        {
          type: 'handover.sealed',
          handoverId,
          containerNumber: CONTAINER,
          occurredAt: new Date().toISOString(),
        },
        { id: randomUUID(), publicUrl: 'https://plomba.example.com' },
      ),
    );

  it('reviews every new damage when the chain does not verify', async () => {
    const event = await eventFor(plomba.journey.handovers.lodzIn.id);
    const history = await plomba.client.containerHistory(CONTAINER);
    const broken = { ...history, chain: { ok: false, length: 3, brokenAt: 0 }, damage: [] };
    const decision = buildClaims(event, broken);
    expect(decision.claims).toEqual([]);
    expect(decision.reviews.map((r) => [r.damage.id, r.reason])).toEqual([
      [plomba.journey.damage.dent.id, 'unverified'],
    ]);
  });

  it('reviews known damage that got worse, and links to the installation’s public address', async () => {
    const event = await eventFor(plomba.journey.handovers.lodzOut.id);
    const history = await plomba.client.containerHistory(CONTAINER);
    const { dent } = plomba.journey.damage;
    const worse = {
      ...event,
      data: {
        ...event.data,
        damage: event.data.damage.map((d) =>
          d.id === dent.id
            ? {
                ...d,
                trail: d.trail.map((s, i) => (i === 1 ? { ...s, status: 'changed' as const } : s)),
              }
            : d,
        ),
      },
    };
    const review = buildClaims(worse, history).reviews.find((r) => r.damage.id === dent.id);
    expect(review?.reason).toBe('changed');
    expect(review?.related[0]?.links.receipt).toBe(
      `https://plomba.example.com/handovers/${plomba.journey.handovers.lodzIn.id}/report`,
    );
  });

  it('skips damage on the container’s first sealed record', async () => {
    const event = await eventFor(plomba.journey.handovers.gdynia.id);
    const history = await plomba.client.containerHistory(CONTAINER);
    const decision = buildClaims(event, history);
    expect(decision).toMatchObject({ claims: [], reviews: [] });
    expect(decision.skipped[0]?.reason).toContain('first sealed record');
  });
});

describe('the command line', () => {
  it('listens, opens claims from signed deliveries, and stops cleanly', async () => {
    const plomba = await installationWithJourney();
    const outDir = await mkdtemp(join(tmpdir(), 'plomba-claims-'));
    const cli = await startCli(
      'shipping-line-claims-desk/main.ts',
      ['--port', '0', '--out', outDir],
      { ...plomba.env, PLOMBA_WEBHOOK_SECRET: SECRET },
      /listening on (http:\/\/\S+)/,
    );
    try {
      const event = WebhookEventSchema.parse(
        await describeHandoverEvent(
          plomba.sandbox.handovers,
          {
            type: 'handover.sealed',
            handoverId: plomba.journey.handovers.lodzIn.id,
            containerNumber: CONTAINER,
            occurredAt: new Date().toISOString(),
          },
          { id: randomUUID(), publicUrl: plomba.sandbox.url },
        ),
      );
      const body = JSON.stringify(event);
      const response = await fetch(cli.match[1] ?? '', {
        method: 'POST',
        headers: { 'plomba-delivery': event.id, 'plomba-signature': sign(SECRET, now(), body) },
        body,
      });
      expect(response.status).toBe(202);
    } finally {
      // Stopping waits for the accepted event to be processed.
      expect(await cli.stop()).toBe(0);
      await plomba.sandbox.close();
    }
    expect(cli.output()).toContain('1 claim(s), 0 for review');
    expect(await readdir(join(outDir, 'claims'))).toHaveLength(2);
  });
});
