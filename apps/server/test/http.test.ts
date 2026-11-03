import {
  FaceViewsSchema,
  HandoverListSchema,
  IdentifyResultSchema,
  ProblemSchema,
  StartHandoverSchema,
} from '@plomba/contracts';
import { describe, expect, it } from 'vitest';
import { createTestApp, FakeFaceViewClassifier, FakeReader, makePhoto, makeWav } from './fakes.ts';
import { handoverSearchFixture } from './handover-search-fixture.ts';

function testApp() {
  const reader = new FakeReader('LSOU1077379');
  reader.choice = 'LSCU1077379';
  return createTestApp({ reader }).app;
}

describe('HTTP API', () => {
  it('reports health', async () => {
    const response = await testApp().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('sets a camera-only permissions policy and a content security policy', async () => {
    const response = await testApp().request('/api/health');
    expect(response.headers.get('permissions-policy')).toContain('camera=(self)');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('identifies a container from an uploaded photo', async () => {
    const form = new FormData();
    form.set('image', new File([(await makePhoto()) as Uint8Array<ArrayBuffer>], 'door.jpg'));
    const response = await testApp().request('/api/identify', { method: 'POST', body: form });
    expect(response.status).toBe(200);
    const result = IdentifyResultSchema.parse(await response.json());
    expect(result.verdict).toBe('suggested');
    expect(result.candidates[0]?.containerNumber).toBe('LSCU1077379');
  });

  it('returns problem details for invalid input', async () => {
    const response = await testApp().request('/api/handovers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ containerNumber: 'CSQU3054383', direction: 'sideways' }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const problem = ProblemSchema.parse(await response.json());
    expect(problem.issues?.map((i) => i.path)).toEqual(
      expect.arrayContaining(['direction', 'place', 'checker']),
    );
  });

  it('runs a handover end to end', async () => {
    const app = testApp();
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    expect(
      (await post('/api/containers', { number: 'CSQU3054383', sizeTypeCode: '42G1' })).status,
    ).toBe(201);
    const started = await post('/api/handovers', {
      containerNumber: 'CSQU3054383',
      direction: 'in',
      place: 'Gdynia',
      checker: 'PL',
    });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };

    const form = new FormData();
    form.set('face', 'D');
    form.set('image', new File([(await makePhoto()) as Uint8Array<ArrayBuffer>], 'd.jpg'));
    const photo = await app.request(`/api/handovers/${id}/photos`, { method: 'POST', body: form });
    expect(photo.status).toBe(201);
    const { url } = (await photo.json()) as { url: string };
    const media = await app.request(url);
    expect(media.headers.get('content-type')).toBe('image/jpeg');

    const refused = await post(`/api/handovers/${id}/close`, {});
    expect(refused.status).toBe(409);
    const closed = await post(`/api/handovers/${id}/close`, { acceptGaps: true });
    expect(closed.status).toBe(200);
    const history = await app.request('/api/containers/CSQU3054383');
    expect(((await history.json()) as { chain: unknown }).chain).toEqual({
      ok: true,
      length: 1,
      brokenAt: null,
    });

    const resized = await post('/api/containers', {
      number: 'CSQU3054383',
      sizeTypeCode: '22G1',
    });
    expect(resized.status).toBe(409);
    expect(resized.headers.get('content-type')).toContain('application/problem+json');
    expect(ProblemSchema.parse(await resized.json()).title).toBe(
      'Cannot change container dimensions after a handover has been sealed',
    );
  });

  it('refuses a photo whose capture time is not a date, and stores capture times in UTC', async () => {
    const app = testApp();
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    await post('/api/containers', { number: 'CSQU3054383', sizeTypeCode: '42G1' });
    const started = await post('/api/handovers', {
      containerNumber: 'CSQU3054383',
      direction: 'in',
      place: 'Gdynia',
      checker: 'PL',
    });
    const { id } = (await started.json()) as { id: string };
    const upload = async (capturedAt: string) => {
      const form = new FormData();
      form.set('face', 'D');
      form.set('capturedAt', capturedAt);
      form.set('image', new File([(await makePhoto()) as Uint8Array<ArrayBuffer>], 'd.jpg'));
      return app.request(`/api/handovers/${id}/photos`, { method: 'POST', body: form });
    };

    expect((await upload('not-a-date')).status).toBe(400);
    const photo = await upload('2026-11-03T15:05:11+01:00');
    expect(photo.status).toBe(201);
    expect(((await photo.json()) as { capturedAt: string }).capturedAt).toBe(
      '2026-11-03T14:05:11.000Z',
    );
    const detail = await app.request(`/api/handovers/${id}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { photos: unknown[] }).photos).toHaveLength(1);
  });

  it('transcribes a spoken note', async () => {
    const form = new FormData();
    form.set('audio', new File([makeWav() as Uint8Array<ArrayBuffer>], 'note.wav'));
    const response = await testApp().request('/api/transcribe', { method: 'POST', body: form });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'wgniecenie przy drzwiach', durationMs: 1000 });
  });

  it('names the faces in the frames of a walk-around, in order', async () => {
    const classifier = new FakeFaceViewClassifier([
      {
        face: 'D',
        squareOn: true,
        corner: null,
        doorEnd: null,
        clear: true,
        confidence: 0.9,
        note: 'doors',
      },
      {
        face: 'L',
        squareOn: true,
        corner: null,
        doorEnd: null,
        clear: true,
        confidence: 0.7,
        note: 'side, doors on the right',
      },
    ]);
    const { app } = createTestApp({ classifier });
    const form = new FormData();
    for (const name of ['1.jpg', '2.jpg']) {
      form.append('frame', new File([(await makePhoto()) as Uint8Array<ArrayBuffer>], name));
    }
    const response = await app.request('/api/videos/faces', { method: 'POST', body: form });
    expect(response.status).toBe(200);
    const { views } = FaceViewsSchema.parse(await response.json());
    expect(views.map((v) => v.face)).toEqual(['D', 'L']);
    expect(classifier.calls).toEqual([2]);
  });

  it('answers unknown API routes with 404 problem details', async () => {
    const response = await testApp().request('/api/nope');
    expect(response.status).toBe(404);
  });
});

describe('HTTP handover search', () => {
  it('preserves the bare request and carries its open-first order across pages', async () => {
    const f = await handoverSearchFixture();
    try {
      f.service.registerContainer({ number: 'PLBU4000043' });
      for (let i = 0; i < 27; i++) {
        const handover = f.service.start(
          StartHandoverSchema.parse({
            containerNumber: 'PLBU4000043',
            direction: 'in',
            place: 'Gdynia',
            checker: 'Gate checker',
          }),
        );
        await f.service.close(handover.id, { acceptGaps: true });
      }
      const first = await f.app.request('/api/handovers');
      const handovers = HandoverListSchema.parse(await first.json());
      expect(handovers).toEqual(f.service.recent());
      expect(handovers).toHaveLength(30);
      expect(handovers.slice(0, 2).map((h) => h.id)).toEqual([f.wagon.id, f.openTruck.id]);
      const next = first.headers.get('link')?.match(/<([^>]+)>/)?.[1];
      if (!next) throw new Error('Missing next-page link');
      const arrived = f.service.start(
        StartHandoverSchema.parse({
          containerNumber: 'PLBU4000043',
          direction: 'in',
          place: 'Gdynia',
          checker: 'Gate checker',
        }),
      );
      const second = await f.app.request(next);
      const remaining = HandoverListSchema.parse(await second.json());
      expect(remaining.map((h) => h.id)).toEqual([f.tiedB.id, f.tiedA.id, f.older.id]);
      expect(second.headers.get('link')).toBeNull();
      expect(new Set([...handovers, ...remaining].map((h) => h.id)).size).toBe(33);
      expect(remaining.some((h) => h.id === arrived.id)).toBe(false);
    } finally {
      f.db.close();
    }
  });

  it('keeps the array response and advertises the next page with all filters', async () => {
    const f = await handoverSearchFixture();
    try {
      const query = new URLSearchParams({
        vehicle: 'el 4k-217',
        status: 'closed',
        direction: 'out',
        place: 'Gdynia',
        limit: '1',
      });
      const first = await f.app.request(`/api/handovers?${query}`);
      expect(first.status).toBe(200);
      expect(HandoverListSchema.parse(await first.json()).map((h) => h.id)).toEqual([f.tiedB.id]);
      const header = first.headers.get('link');
      expect(header).toMatch(/^<\/api\/handovers\?[^>]+>; rel="next"$/);
      const target = header?.match(/<([^>]+)>/)?.[1];
      if (!target) throw new Error('Missing next-page link');
      const next = new URL(target, 'http://localhost');
      for (const [name, value] of query) expect(next.searchParams.get(name)).toBe(value);
      expect(next.searchParams.get('cursor')).toBeTruthy();
      expect(next.searchParams.getAll('cursor')).toHaveLength(1);
      const second = await f.app.request(target);
      expect(HandoverListSchema.parse(await second.json()).map((h) => h.id)).toEqual([f.older.id]);
      expect(second.headers.get('link')).toBeNull();
      const empty = await f.app.request('/api/handovers?vehicle=unknown');
      expect(await empty.json()).toEqual([]);
      expect(empty.headers.get('link')).toBeNull();
      const container = await f.app.request('/api/handovers?container=csqu+305438-3&status=open');
      expect(HandoverListSchema.parse(await container.json()).map((h) => h.id)).toEqual([
        f.openTruck.id,
      ]);
    } finally {
      f.db.close();
    }
  });

  it.each([
    ['status', 'sealed'],
    ['direction', 'sideways'],
    ['limit', '0'],
    ['limit', '101'],
    ['limit', '1.5'],
    ['limit', 'bad'],
    ['limit', ''],
    ['cursor', ''],
    ['cursor', '%%%'],
    ['cursor', Buffer.from('{}').toString('base64url')],
    [
      'cursor',
      Buffer.from(JSON.stringify({ startedAt: 'yesterday', id: 'bad' })).toString('base64url'),
    ],
    ['container', 'CSQU3054384'],
    ['container', 'bad'],
    ['vehicle', ' - '],
    ['place', ''],
  ])('returns a 400 problem for %s=%s', async (name, value) => {
    const { app, db } = createTestApp();
    try {
      const response = await app.request(
        `/api/handovers?${new URLSearchParams({ [name]: value })}`,
      );
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      const problem = ProblemSchema.parse(await response.json());
      expect(problem.status).toBe(400);
      expect(problem.issues?.map((issue) => issue.path)).toContain(name);
    } finally {
      db.close();
    }
  });
});
