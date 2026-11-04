import { createHash } from 'node:crypto';
import {
  HandoverDetailSchema,
  InstanceSchema,
  ProblemSchema,
  VideoSchema,
  VideoTrackingSchema,
} from '@plomba/contracts';
import { describe, expect, it, vi } from 'vitest';
import { SqliteVideoRepository } from '../src/adapters/sqlite/repositories.ts';
import { ConflictError, ServiceUnavailableError, ValidationError } from '../src/errors.ts';
import { createTestApp, makePhoto, markInput, rectangleObject } from './fakes.ts';
import { useLegacyRecord } from './legacy-record.ts';

const NUMBER = 'CSQU3054383';
const mp4 = (brand = 'isom', tail = '') =>
  new TextEncoder().encode(`\0\0\0\x18ftyp${brand}\0\0\0\0isommp42${tail}`);
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
const views = [
  {
    frame: 12,
    view: {
      face: 'D',
      squareOn: true,
      clear: true,
      corner: null,
      doorEnd: null,
      confidence: 0.9,
      note: 'doors',
    },
  },
];

function started(options: Parameters<typeof createTestApp>[0] = {}) {
  const context = createTestApp(options);
  context.service.registerContainer({ number: NUMBER });
  const handover = context.service.start({
    containerNumber: NUMBER,
    direction: 'in',
    place: 'Gdynia',
    checker: 'PL',
    sealNumbers: [],
  });
  return { ...context, handover };
}

function form(data = mp4(), named: unknown = views) {
  const body = new FormData();
  // Neither the filename nor the declared type identifies the stored format.
  body.set('video', new File([data], 'photo.jpg', { type: 'image/jpeg' }));
  if (named !== undefined)
    body.set('views', typeof named === 'string' ? named : JSON.stringify(named));
  return body;
}

describe('handover video evidence', () => {
  it.each([
    [mp4(), 'video/mp4'],
    [mp4('qt  '), 'video/quicktime'],
    [webm, 'video/webm'],
  ] as const)('redacts a %s clip before storing it as MP4', async (data, contentType) => {
    const { service, db, media, handover, redactor } = started();
    try {
      const redact = redactor.redact.bind(redactor);
      let redacted = new Uint8Array();
      vi.spyOn(redactor, 'redact').mockImplementation(async (input) => {
        expect(media.files.size).toBe(0);
        const result = await redact(input);
        redacted = result.data;
        return result;
      });
      const video = await service.addVideo(handover.id, { data, views });
      const sourceSha256 = createHash('sha256').update(data).digest('hex');
      const sha256 = createHash('sha256').update(redacted).digest('hex');
      expect(redactor.calls).toEqual([{ data, mimeType: contentType }]);
      expect(VideoSchema.parse(video)).toMatchObject({
        contentType: 'video/mp4',
        size: redacted.length,
        sha256,
        views,
      });
      expect(sha256).not.toBe(sourceSha256);
      expect(await media.get(video.sha256)).toEqual(redacted);
      expect(await media.get(sourceSha256)).toBeUndefined();
      const repository = new SqliteVideoRepository(db);
      expect(repository.get(video.id)).toEqual(video);
      expect(repository.listForHandover(handover.id)).toEqual([video]);
      expect(repository.listForHandover('missing')).toEqual([]);
      expect(repository.get('missing')).toBeUndefined();
      expect(repository.findBySource(handover.id, sourceSha256)).toEqual(video);
      expect(repository.findBySource('missing', sourceSha256)).toBeUndefined();
      expect(service.detail(handover.id).videos).toEqual([video]);
    } finally {
      db.close();
    }
  });

  it('stores nothing when redaction fails', async () => {
    const { service, media, db, handover, redactor } = started();
    try {
      vi.spyOn(redactor, 'redact').mockRejectedValue(new Error('privacy tracking failed'));
      await expect(service.addVideo(handover.id, { data: mp4() })).rejects.toThrow(
        'privacy tracking failed',
      );
      expect(media.files.size).toBe(0);
      expect(service.detail(handover.id).videos).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('de-duplicates retries by the source hash, including concurrent redactions with different results', async () => {
    let calls = 0;
    const { service, handover, db } = started({
      videoRedactor: {
        redact: async () => ({
          data: mp4('isom', `redacted-${++calls}`),
          mimeType: 'video/mp4',
          regions: 1,
        }),
      },
    });
    try {
      const [first, second] = await Promise.all([
        service.addVideo(handover.id, { data: mp4() }),
        service.addVideo(handover.id, { data: mp4() }),
      ]);
      expect(second).toEqual(first);
      expect(service.detail(handover.id).videos).toEqual([first]);
      expect(await service.addVideo(handover.id, { data: mp4() })).toEqual(first);
      expect(calls).toBe(2);
    } finally {
      db.close();
    }
  });

  it('rejects non-video bytes and invalid views before storing anything', async () => {
    const { service, media, db, handover } = started();
    try {
      await expect(service.addVideo(handover.id, { data: await makePhoto() })).rejects.toThrow(
        ValidationError,
      );
      for (const invalid of [
        null,
        {},
        [{ frame: -1, view: views[0]?.view }],
        [{ frame: 0, view: { face: 'X' } }],
      ]) {
        await expect(
          service.addVideo(handover.id, { data: mp4(), views: invalid }),
        ).rejects.toThrow(ValidationError);
      }
      expect(media.files.size).toBe(0);
    } finally {
      db.close();
    }
  });

  it('remembers both source hashes when different uploads redact to identical bytes', async () => {
    let calls = 0;
    const { service, handover, db } = started({
      videoRedactor: {
        redact: async () => ({
          data: mp4('isom', ++calls <= 2 ? 'shared-redaction' : 'different-redaction'),
          mimeType: 'video/mp4',
          regions: 1,
        }),
      },
    });
    try {
      const first = await service.addVideo(handover.id, { data: mp4('isom', 'first') });
      expect(await service.addVideo(handover.id, { data: mp4('isom', 'second') })).toEqual(first);
      expect(await service.addVideo(handover.id, { data: mp4('isom', 'second') })).toEqual(first);
      expect(await service.addVideo(handover.id, { data: mp4('isom', 'first') })).toEqual(first);
      expect(calls).toBe(2);
      expect(service.detail(handover.id).videos).toEqual([first]);
    } finally {
      db.close();
    }
  });

  it('keeps at most three distinct clips, including concurrent uploads and retries', async () => {
    const { service, handover, db } = started();
    try {
      const video = await service.addVideo(handover.id, { data: mp4() });
      const results = await Promise.allSettled(
        [1, 2, 3].map((n) => service.addVideo(handover.id, { data: mp4('isom', String(n)) })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.any(ConflictError),
      });
      expect(await service.addVideo(handover.id, { data: mp4() })).toEqual(video);
      expect(service.detail(handover.id).videos).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it('seals the clip hashes and refuses uploads during sealing or after closure', async () => {
    const { service, handover, db } = started();
    try {
      const video = await service.addVideo(handover.id, { data: mp4(), views });
      const closing = service.close(handover.id, { acceptGaps: true });
      await expect(service.addVideo(handover.id, { data: mp4('isom', 'new') })).rejects.toThrow(
        ConflictError,
      );
      await closing;
      await expect(service.addVideo(handover.id, { data: mp4() })).rejects.toThrow(ConflictError);
      const row = db.prepare('SELECT record FROM handovers WHERE id = ?').get(handover.id) as {
        record: string;
      };
      expect(JSON.parse(row.record)).toMatchObject({
        version: 3,
        videos: [
          { id: video.id, sha256: video.sha256, size: video.size, contentType: video.contentType },
        ],
      });
      expect((await service.history(NUMBER)).chain.ok).toBe(true);
      db.prepare('UPDATE handovers SET record = replace(record, ?, ?) WHERE id = ?').run(
        video.sha256,
        'f'.repeat(64),
        handover.id,
      );
      expect((await service.history(NUMBER)).chain.ok).toBe(false);
    } finally {
      db.close();
    }
  });

  it('refuses an upload that started before the handover was sealed', async () => {
    const { service, media, handover, db } = started();
    try {
      const put = media.put.bind(media);
      let release = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      media.put = async (data) => {
        await waiting;
        return put(data);
      };
      const adding = service.addVideo(handover.id, { data: mp4() });
      await service.close(handover.id, { acceptGaps: true });
      release();
      await expect(adding).rejects.toThrow(ConflictError);
      expect(service.detail(handover.id).videos).toEqual([]);
    } finally {
      db.close();
    }
  });

  it.each([1, 2] as const)(
    'reads version %i evidence and appends a version 3 record without breaking the chain',
    async (version) => {
      const { service, handover, db, app } = started();
      try {
        const mark = service.addMark(handover.id, markInput({ damageCode: 'DT' }));
        await service.close(handover.id, { acceptGaps: true });
        await useLegacyRecord(db, handover.id, version);
        const second = service.start({
          containerNumber: NUMBER,
          direction: 'out',
          place: 'Łódź',
          checker: 'AN',
          sealNumbers: [],
        });
        await service.addVideo(second.id, { data: mp4() });
        await service.close(second.id, { acceptGaps: true });
        const history = await service.history(NUMBER);
        expect(history.chain).toEqual({ ok: true, length: 2, brokenAt: null });
        expect(history.damage).toEqual([
          expect.objectContaining({ id: mark.id, firstRecorded: handover.id }),
        ]);
        const response = await app.request(`/api/handovers/${handover.id}`);
        expect(HandoverDetailSchema.parse(await response.json()).videos).toEqual([]);
        expect(service.codeco(handover.id, 'RECIPIENT').content).toContain('CSQU3054383');
      } finally {
        db.close();
      }
    },
  );
});

describe('video HTTP API', () => {
  it('refuses video evidence with a 503 problem and advertises it as unavailable without a redactor', async () => {
    const { service, app, handover, db, media, segmenter } = started({ videoRedactor: null });
    try {
      expect(InstanceSchema.parse(await (await app.request('/api/instance')).json())).toEqual({
        notice: null,
        videoEvidence: false,
      });
      await expect(service.addVideo(handover.id, { data: mp4() })).rejects.toThrow(
        ServiceUnavailableError,
      );
      const response = await app.request(`/api/handovers/${handover.id}/videos`, {
        method: 'POST',
        body: form(),
      });
      expect(response.status).toBe(503);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(ProblemSchema.parse(await response.json())).toMatchObject({
        status: 503,
        title: expect.stringContaining('blur people and number plates'),
      });
      expect(media.files.size).toBe(0);
      expect(segmenter.calls).toEqual([]);
      expect(service.detail(handover.id).videos).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('keeps photo responses and their cache headers', async () => {
    const { service, app, handover, db, media } = started();
    try {
      const photo = await service.addPhoto(handover.id, { face: 'D', data: await makePhoto() });
      const response = await app.request(photo.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(await media.get(photo.sha256));
    } finally {
      db.close();
    }
  });

  it('uploads and lists a clip, returning problem details for invalid inputs and closed handovers', async () => {
    const { app, handover, db, service } = started();
    const upload = (body: FormData) =>
      app.request(`/api/handovers/${handover.id}/videos`, { method: 'POST', body });
    try {
      for (const body of [
        new FormData(),
        form(new TextEncoder().encode('not a video')),
        form(mp4(), '{'),
        form(mp4(), [{}]),
      ]) {
        const bad = await upload(body);
        expect(bad.status).toBe(400);
        expect(ProblemSchema.parse(await bad.json()).status).toBe(400);
      }
      const response = await upload(form());
      expect(response.status).toBe(201);
      const video = VideoSchema.parse(await response.json());
      expect(video.contentType).toBe('video/mp4');
      const detail = await app.request(`/api/handovers/${handover.id}`);
      expect(HandoverDetailSchema.parse(await detail.json()).videos).toEqual([video]);
      const withoutViews = new FormData();
      withoutViews.set('video', new File([webm], 'clip.webm'));
      expect(VideoSchema.parse(await (await upload(withoutViews)).json()).views).toEqual([]);
      expect((await upload(form(mp4('isom', 'third')))).status).toBe(201);
      const full = await upload(form(mp4('isom', 'fourth')));
      expect(full.status).toBe(409);
      expect(ProblemSchema.parse(await full.json()).status).toBe(409);
      await service.close(handover.id, { acceptGaps: true });
      expect((await upload(form())).status).toBe(409);
    } finally {
      db.close();
    }
  });

  it('has its own 150 MB body limit and preserves the photo limit', async () => {
    const { app, handover, db } = started();
    try {
      for (const [route, bytes] of [
        ['videos', 150 * 1024 * 1024 + 1],
        ['photos', 20 * 1024 * 1024 + 1],
      ] as const) {
        const response = await app.request(`/api/handovers/${handover.id}/${route}`, {
          method: 'POST',
          headers: { 'content-length': String(bytes) },
          body: 'x',
        });
        expect(response.status).toBe(413);
        expect(ProblemSchema.parse(await response.json()).status).toBe(413);
      }
    } finally {
      db.close();
    }
  });

  it.each([
    [mp4(), 'video/mp4'],
    [mp4('qt  '), 'video/quicktime'],
    [webm, 'video/webm'],
  ] as const)('serves redacted MP4 bytes and byte ranges for %s', async (source, _contentType) => {
    const { app, service, handover, db, media } = started();
    try {
      const video = await service.addVideo(handover.id, { data: source });
      const data = (await media.get(video.sha256)) as Uint8Array;
      const full = await app.request(video.url);
      expect(full.status).toBe(200);
      expect(full.headers.get('content-type')).toBe('video/mp4');
      expect(full.headers.get('accept-ranges')).toBe('bytes');
      expect(full.headers.get('content-length')).toBe(String(data.length));
      expect(full.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(new Uint8Array(await full.arrayBuffer())).toEqual(data);
      for (const [range, start, end] of [
        ['bytes=0-3', 0, 3],
        ['bytes=4-', 4, data.length - 1],
        ['bytes=-4', data.length - 4, data.length - 1],
        ['bytes=0-9999', 0, data.length - 1],
      ] as const) {
        const response = await app.request(video.url, { headers: { range } });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${data.length}`);
        expect(response.headers.get('content-length')).toBe(String(end - start + 1));
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(data.subarray(start, end + 1));
      }
      for (const range of ['bytes=9999-', 'bytes=5-2', 'bytes=-0']) {
        const response = await app.request(video.url, { headers: { range } });
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe(`bytes */${data.length}`);
      }
    } finally {
      db.close();
    }
  });

  it('copies cached source tracking to the stored hash and returns 404 when absent without calling the model', async () => {
    const { app, service, handover, db, segmenter } = started();
    try {
      const untracked = await service.addVideo(handover.id, { data: mp4('isom', 'untracked') });
      const missingPath = `/api/handovers/${handover.id}/videos/${untracked.id}/tracking`;
      const missing = await app.request(missingPath);
      expect(missing.status).toBe(404);
      expect(ProblemSchema.parse(await missing.json()).status).toBe(404);
      expect(segmenter.calls).toEqual([]);
      segmenter.tracked = [{ frame: 0, objects: [rectangleObject(0, 0, 100, 50)] }];
      const tracked = await app.request('/api/videos/track', { method: 'POST', body: form() });
      const tracking = VideoTrackingSchema.parse(await tracked.json());
      const video = await service.addVideo(handover.id, { data: mp4() });
      expect(video.sha256).not.toBe(createHash('sha256').update(mp4()).digest('hex'));
      const path = `/api/handovers/${handover.id}/videos/${video.id}/tracking`;
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(VideoTrackingSchema.parse(await response.json())).toEqual({
        ...tracking,
        cached: true,
      });
      expect(segmenter.calls).toEqual(['track:shipping container']);
      const foreign = await app.request(`/api/handovers/missing/videos/${video.id}/tracking`);
      expect(foreign.status).toBe(404);
      const absent = await app.request(`/api/handovers/${handover.id}/videos/missing/tracking`);
      expect(absent.status).toBe(404);
    } finally {
      db.close();
    }
  });
});
