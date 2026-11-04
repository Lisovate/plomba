import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  CloseHandoverSchema,
  CreateMarkSchema,
  DraftClaimSchema,
  FaceSchema,
  RegisterContainerSchema,
  StartHandoverSchema,
  UpdateCornersSchema,
  UpdateMarkSchema,
} from '@plomba/contracts';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { AppError, NotFoundError, ValidationError } from '../errors.ts';
import type { SampleClips } from '../media/sample-clips.ts';
import { videoContentType } from '../media/video.ts';
import type { MediaStore } from '../ports.ts';
import type { ClaimService } from '../services/claims.ts';
import type { HandoverService } from '../services/handovers.ts';
import type { IdentifyService } from '../services/identify.ts';
import type { SpeechService } from '../services/speech.ts';
import type { SpokenDamageService } from '../services/spoken-damage.ts';
import type { VideoService } from '../services/video.ts';
import { type ApiToken, installAccessControl } from './access.ts';
import { openApiDocument } from './openapi.ts';

export interface AppDeps {
  readonly identify: IdentifyService;
  readonly handovers: HandoverService;
  readonly speech: SpeechService;
  readonly spokenDamage: SpokenDamageService;
  readonly claims: ClaimService;
  readonly video: VideoService;
  readonly media: MediaStore;
  readonly logger: Logger;
  /** The built web app, served with a single-page-app fallback. */
  readonly webDistDir?: string | undefined;
  /** When set, API and media requests need a session obtained with this code. */
  readonly accessCode?: string | undefined;
  /** Tokens other systems send as `Authorization: Bearer …`, when an access code is set. */
  readonly apiTokens?: readonly ApiToken[] | undefined;
  /** The operator's notice for the foot of every screen. */
  readonly notice?: string | undefined;
  /** Sample clips and photos to try the app with. */
  readonly samples?: SampleClips | undefined;
  /** This installation's address, for the API description. */
  readonly publicUrl?: string | undefined;
}

/** Phones produce 3–12 MB photos; leave room for multipart overhead. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      permissionsPolicy: {
        camera: ['self'],
        microphone: ['self'],
        geolocation: ['self'],
      },
    }),
  );

  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    deps.logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      },
      'request',
    );
  });

  app.onError((error, c) => {
    if (error instanceof AppError) {
      if (error.status >= 500) deps.logger.error({ err: error }, error.message);
      return problem(c, error.status, error.type, error.message, error.issues);
    }
    if (error instanceof HTTPException) {
      return problem(c, error.status, 'http', error.message || 'Request rejected');
    }
    deps.logger.error({ err: error }, 'Unhandled error');
    return problem(c, 500, 'internal', 'Something went wrong on the server');
  });

  installAccessControl(app, deps.accessCode, deps.apiTokens);
  app.route('/api', api(deps));

  app.get('/media/:sha256', async (c) => {
    const data = await deps.media.get(c.req.param('sha256'));
    if (!data) return problem(c, 404, 'not-found', 'No such media');
    c.header('content-type', videoContentType(data) ?? 'image/jpeg');
    // Content-addressed: the bytes behind a hash never change.
    c.header('cache-control', 'private, max-age=31536000, immutable');
    c.header('accept-ranges', 'bytes');
    const range = c.req.header('if-range')
      ? undefined
      : byteRange(c.req.header('range'), data.length);
    if (range === null) {
      c.header('content-range', `bytes */${data.length}`);
      return c.body(null, 416);
    }
    if (range) {
      const { start, end } = range;
      c.header('content-range', `bytes ${start}-${end}/${data.length}`);
      c.header('content-length', String(end - start + 1));
      return c.body(data.subarray(start, end + 1) as Uint8Array<ArrayBuffer>, 206);
    }
    c.header('content-length', String(data.length));
    return c.body(data as Uint8Array<ArrayBuffer>, 200);
  });

  if (deps.webDistDir) serveWebApp(app, deps.webDistDir);
  return app;
}

function api(deps: AppDeps): Hono {
  const api = new Hono();
  const { identify, handovers, speech, spokenDamage, claims, video } = deps;
  const uploadLimit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: () => {
      throw new HTTPException(413, { message: 'Upload is too large' });
    },
  });

  api.get('/health', (c) => c.json({ status: 'ok' }));

  api.get('/instance', (c) =>
    c.json({ notice: deps.notice ?? null, videoEvidence: handovers.videoEvidence }),
  );

  const openApi = openApiDocument({ serverUrl: deps.publicUrl ?? '' });
  api.get('/openapi.json', (c) => c.json(openApi));

  api.get('/samples', (c) => c.json(deps.samples?.list() ?? []));

  api.get('/samples/:file', async (c) => {
    const clip = await deps.samples?.read(c.req.param('file'));
    if (!clip) throw new NotFoundError('No such sample');
    return c.body(clip.data as Uint8Array<ArrayBuffer>, 200, {
      'content-type': clip.mimeType,
      'cache-control': 'private, max-age=86400',
    });
  });

  // Walk-around clips from a phone: up to a few minutes of 1080p.
  const videoLimit = bodyLimit({
    maxSize: MAX_VIDEO_BYTES,
    onError: () => {
      throw new HTTPException(413, { message: 'The video is too large' });
    },
  });

  api.post('/videos/track', videoLimit, async (c) => {
    const form = await c.req.parseBody().catch(() => {
      throw new ValidationError('Expected multipart/form-data');
    });
    const file = form.video;
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError('Attach the clip as the "video" field');
    }
    return c.json(await video.track(new Uint8Array(await file.arrayBuffer())));
  });

  // The chosen frames of a walk-around, in clip order, as repeated "frame" fields.
  api.post('/videos/faces', videoLimit, async (c) => {
    const form = await c.req.parseBody({ all: true }).catch(() => {
      throw new ValidationError('Expected multipart/form-data');
    });
    const files = [form.frame ?? []].flat().filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new ValidationError('Attach the frames as "frame" fields');
    const frames = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    let source: unknown;
    if (form.source !== undefined) {
      if (typeof form.source !== 'string') throw new ValidationError('source must be JSON');
      try {
        source = JSON.parse(form.source);
      } catch {
        throw new ValidationError('source must be JSON');
      }
    }
    return c.json(await video.faces(frames, source));
  });

  api.post('/identify', uploadLimit, async (c) => {
    const { image } = await readUpload(c);
    return c.json(await identify.identify(image));
  });

  api.post('/transcribe', uploadLimit, async (c) => {
    const form = await c.req.parseBody().catch(() => {
      throw new ValidationError('Expected multipart/form-data');
    });
    const audio = form.audio;
    if (!(audio instanceof File) || audio.size === 0) {
      throw new ValidationError('Attach the recording as the "audio" field');
    }
    return c.json(await speech.transcribeNote(new Uint8Array(await audio.arrayBuffer())));
  });

  api.post('/containers', async (c) => {
    const input = await readJson(c, RegisterContainerSchema);
    return c.json(handovers.registerContainer(input), 201);
  });

  api.get('/containers', (c) =>
    c.json(
      handovers.listContainers({
        owner: c.req.query('owner'),
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      }),
    ),
  );

  api.get('/containers/:number', async (c) =>
    c.json(await handovers.history(c.req.param('number'))),
  );

  api.post('/handovers', async (c) => {
    const input = await readJson(c, StartHandoverSchema);
    return c.json(handovers.start(input), 201);
  });

  api.get('/handovers', (c) => {
    // A bare request is the checker's list (open handovers first); any search is newest first.
    const query = c.req.query();
    const page = handovers.search(query, Object.keys(query).length > 0 ? 'newest' : 'open-first');
    if (page.nextCursor) {
      const next = new URL(c.req.url);
      next.searchParams.set('cursor', page.nextCursor);
      c.header('Link', `<${next.pathname}${next.search}>; rel="next"`);
    }
    return c.json(page.handovers);
  });

  api.get('/handovers/:id', (c) => c.json(handovers.detail(c.req.param('id'))));

  const evidenceVideoLimit = bodyLimit({
    maxSize: 150 * 1024 * 1024,
    onError: () => {
      throw new HTTPException(413, { message: 'The video is too large (maximum 150 MB)' });
    },
  });

  api.post('/handovers/:id/videos', evidenceVideoLimit, async (c) => {
    const form = await c.req.parseBody().catch(() => {
      throw new ValidationError('Expected multipart/form-data');
    });
    const file = form.video;
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError('Attach the clip as the "video" field');
    }
    let views: unknown;
    if (form.views !== undefined) {
      if (typeof form.views !== 'string') throw new ValidationError('views must be JSON');
      try {
        views = JSON.parse(form.views);
      } catch {
        throw new ValidationError('views must be JSON');
      }
    }
    return c.json(
      await handovers.addVideo(c.req.param('id'), {
        data: new Uint8Array(await file.arrayBuffer()),
        views,
      }),
      201,
    );
  });

  api.get('/handovers/:id/videos/:videoId/tracking', async (c) => {
    const stored = handovers.video(c.req.param('id'), c.req.param('videoId'));
    const tracking = await video.cached(stored.sha256);
    if (!tracking) throw new NotFoundError('No cached tracking for this video');
    return c.json(tracking);
  });

  api.post('/handovers/:id/photos', uploadLimit, async (c) => {
    const { image, fields } = await readUpload(c);
    const face = FaceSchema.safeParse(fields.face);
    if (!face.success) throw new ValidationError('face must be one of D, R, F, L, T');
    const photo = await handovers.addPhoto(c.req.param('id'), {
      face: face.data,
      data: image,
      ...(typeof fields.capturedAt === 'string' ? { capturedAt: fields.capturedAt } : {}),
    });
    return c.json(photo, 201);
  });

  api.post('/handovers/:id/frames', uploadLimit, async (c) => {
    const { image } = await readUpload(c);
    return c.json(await handovers.registerFrame(c.req.param('id'), image));
  });

  // A spoken description of damage: the recording (WAV) and the face in view.
  api.post('/handovers/:id/spoken-damage', uploadLimit, async (c) => {
    const form = await c.req.parseBody().catch(() => {
      throw new ValidationError('Expected multipart/form-data');
    });
    const face = FaceSchema.safeParse(form.face);
    if (!face.success)
      throw new ValidationError('Send the face in view as "face" (D, R, F, L or T)');
    const audio = form.audio;
    if (!(audio instanceof File) || audio.size === 0) {
      throw new ValidationError('Attach the recording as the "audio" field');
    }
    const data = new Uint8Array(await audio.arrayBuffer());
    return c.json(await spokenDamage.record(c.req.param('id'), face.data, data));
  });

  api.put('/handovers/:id/photos/:photoId/corners', async (c) => {
    const { corners } = await readJson(c, UpdateCornersSchema);
    return c.json(handovers.updateCorners(c.req.param('id'), c.req.param('photoId'), corners));
  });

  api.post('/handovers/:id/photos/:photoId/proposals', async (c) =>
    c.json(await handovers.proposeDamage(c.req.param('id'), c.req.param('photoId')), 201),
  );

  api.post('/handovers/:id/marks', async (c) => {
    const input = await readJson(c, CreateMarkSchema);
    return c.json(handovers.addMark(c.req.param('id'), input), 201);
  });

  api.patch('/handovers/:id/marks/:markId', async (c) => {
    const patch = await readJson(c, UpdateMarkSchema);
    return c.json(handovers.updateMark(c.req.param('id'), c.req.param('markId'), patch));
  });

  api.post('/handovers/:id/close', async (c) => {
    const options = await readJson(c, CloseHandoverSchema);
    return c.json(await handovers.close(c.req.param('id'), options));
  });

  api.post('/handovers/:id/claim', async (c) => {
    const { language } = await readJson(c, DraftClaimSchema);
    return c.json(await claims.draft(c.req.param('id'), language));
  });

  api.get('/handovers/:id/codeco', (c) => {
    const recipient = c.req.query('recipient')?.trim() || 'RECIPIENT';
    const { fileName, content } = handovers.codeco(c.req.param('id'), recipient);
    return c.text(content, 200, {
      'content-disposition': `attachment; filename="${fileName}"`,
    });
  });

  api.all('*', (c) => problem(c, 404, 'not-found', `No route for ${c.req.method} ${c.req.path}`));
  return api;
}

function serveWebApp(app: Hono, root: string): void {
  app.use('/*', serveStatic({ root }));
  // Client-side routes: anything that isn't a file gets the app shell. Read on
  // each request (the OS caches it) so a redeployed build is picked up.
  app.get('*', async (c) => {
    c.header('cache-control', 'no-cache');
    return c.html(await readFile(join(root, 'index.html'), 'utf8'));
  });
}

async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('The request body must be JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('The request body is invalid', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

async function readUpload(
  c: Context,
): Promise<{ image: Uint8Array; fields: Record<string, unknown> }> {
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw new ValidationError('Expected multipart/form-data');
  }
  const file = form.image;
  if (!(file instanceof File) || file.size === 0) {
    throw new ValidationError('Attach the photo as the "image" field');
  }
  return { image: new Uint8Array(await file.arrayBuffer()), fields: form };
}

function problem(
  c: Context,
  status: number,
  type: string,
  title: string,
  issues?: readonly { path: string; message: string }[],
) {
  return c.json(
    { type: `https://plomba.dev/problems/${type}`, title, status, ...(issues ? { issues } : {}) },
    status as 400,
    { 'content-type': 'application/problem+json' },
  );
}

/** One byte range, including open-ended and suffix ranges. Ignore unsupported ranges. */
function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  if (size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start >= size || start > end ? null : { start, end };
}
