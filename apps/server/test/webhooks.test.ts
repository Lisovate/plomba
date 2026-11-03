import { WebhookEventSchema } from '@plomba/contracts';
import { describe, expect, it } from 'vitest';
import { sign, verify, WebhookNotifier } from '../src/adapters/webhooks.ts';
import type { EventPublisher, HandoverEvent } from '../src/ports.ts';
import { describeHandoverEvent } from '../src/services/events.ts';
import { createTestHandoverService, markInput, silentLogger } from './fakes.ts';

const event: HandoverEvent = {
  type: 'handover.sealed',
  handoverId: 'h1',
  containerNumber: 'CSQU3054383',
  occurredAt: '2026-11-03T10:00:00.000Z',
};

describe('webhook signatures', () => {
  const secret = 'a-long-enough-test-secret';
  const body = '{"type":"handover.sealed"}';

  it('verifies what it signs, and nothing else', () => {
    const now = 1_793_700_000;
    const header = sign(secret, now, body);
    expect(verify(secret, header, body, { now })).toBe(true);
    expect(verify(secret, header, `${body} `, { now })).toBe(false);
    expect(verify('another-secret-entirely', header, body, { now })).toBe(false);
  });

  it('refuses an old delivery replayed later', () => {
    const header = sign(secret, 1_793_700_000, body);
    expect(verify(secret, header, body, { now: 1_793_700_000 + 3600 })).toBe(false);
  });
});

describe('WebhookNotifier', () => {
  const payload = (id: string) =>
    ({ id, type: 'handover.sealed', occurredAt: event.occurredAt, data: {} }) as never;

  it('signs each delivery and retries until the receiver accepts it', async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const statuses = [500, 503, 200];
    const notifier = new WebhookNotifier({
      urls: ['https://claims.example.com/plomba'],
      secret: 'a-long-enough-test-secret',
      describe: async (_event, id) => payload(id),
      logger: silentLogger,
      retryDelaysMs: [1, 1, 1],
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: String(init?.body),
        });
        return new Response(null, { status: statuses.shift() ?? 200 });
      },
    });

    await notifier.deliver(event);

    expect(seen).toHaveLength(3);
    const last = seen[2];
    expect(last?.headers.get('plomba-event')).toBe('handover.sealed');
    const signature = last?.headers.get('plomba-signature') ?? '';
    expect(verify('a-long-enough-test-secret', signature, last?.body ?? '')).toBe(true);
    // Every attempt carries the same event id, so receivers can skip duplicates.
    expect(new Set(seen.map((s) => JSON.parse(s.body).id)).size).toBe(1);
  });

  it('gives up quietly after its retries', async () => {
    let calls = 0;
    const notifier = new WebhookNotifier({
      urls: ['https://down.example.com/hook'],
      secret: 'a-long-enough-test-secret',
      describe: async (_event, id) => payload(id),
      logger: silentLogger,
      retryDelaysMs: [1, 1],
      fetch: async () => {
        calls++;
        throw new TypeError('fetch failed');
      },
    });
    await expect(notifier.deliver(event)).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });
});

describe('handover events', () => {
  it('are published when a handover starts and when it is sealed, with a full payload', async () => {
    const published: HandoverEvent[] = [];
    const recorder: EventPublisher = { publish: (e) => published.push(e) };
    const { service } = createTestHandoverService({ events: recorder });
    service.registerContainer({ number: 'CSQU3054383', sizeTypeCode: '22G1' });
    const handover = service.start({
      containerNumber: 'CSQU3054383',
      direction: 'in',
      place: 'Gdynia rail terminal',
      checker: 'P. Lisowski',
      sealNumbers: [],
    });
    service.addMark(handover.id, markInput({ face: 'L', damageCode: 'DT' }));
    await service.close(handover.id, { acceptGaps: true });

    expect(published.map((e) => e.type)).toEqual(['handover.started', 'handover.sealed']);
    const sealed = published[1] as HandoverEvent;
    const body = await describeHandoverEvent(service, sealed, {
      id: '00000000-0000-4000-8000-000000000001',
      publicUrl: 'https://plomba.example.com/',
    });
    const parsed = WebhookEventSchema.parse(body);
    expect(parsed.data.handover.status).toBe('closed');
    expect(parsed.data.damage.map((d) => d.damageCode)).toEqual(['DT']);
    expect(parsed.data.links.receipt).toBe(
      `https://plomba.example.com/handovers/${handover.id}/report`,
    );
  });
});
