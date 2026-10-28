import { IdentifyResultSchema, ProblemSchema } from '@plomba/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { IdentifyService } from '../src/services/identify.ts';
import { createTestHandoverService, FakeReader, makePhoto, silentLogger } from './fakes.ts';

function testApp() {
  const { service, media } = createTestHandoverService();
  const reader = new FakeReader('LSOU1077379');
  reader.choice = 'LSCU1077379';
  return createApp({
    identify: new IdentifyService(reader),
    handovers: service,
    media,
    logger: silentLogger,
  });
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

    const closed = await post(`/api/handovers/${id}/close`, {});
    expect(closed.status).toBe(200);
    const history = await app.request('/api/containers/CSQU3054383');
    expect(((await history.json()) as { chain: unknown }).chain).toEqual({
      ok: true,
      length: 1,
      brokenAt: null,
    });
  });

  it('answers unknown API routes with 404 problem details', async () => {
    const response = await testApp().request('/api/nope');
    expect(response.status).toBe(404);
  });
});
