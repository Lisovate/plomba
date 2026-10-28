import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  CreateMarkSchema,
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
import { AppError, ValidationError } from '../errors.ts';
import type { MediaStore } from '../ports.ts';
import type { HandoverService } from '../services/handovers.ts';
import type { IdentifyService } from '../services/identify.ts';

export interface AppDeps {
  readonly identify: IdentifyService;
  readonly handovers: HandoverService;
  readonly media: MediaStore;
  readonly logger: Logger;
  /** The built web app, served with a single-page-app fallback. */
  readonly webDistDir?: string | undefined;
}

/** Phones produce 3–12 MB photos; leave room for multipart overhead. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

  app.route('/api', api(deps));

  app.get('/media/:sha256', async (c) => {
    const data = await deps.media.get(c.req.param('sha256'));
    if (!data) return problem(c, 404, 'not-found', 'No such media');
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      'content-type': 'image/jpeg',
      // Content-addressed: the bytes behind a hash never change.
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });

  if (deps.webDistDir) serveWebApp(app, deps.webDistDir);
  return app;
}

function api(deps: AppDeps): Hono {
  const api = new Hono();
  const { identify, handovers } = deps;
  const uploadLimit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: () => {
      throw new HTTPException(413, { message: 'Upload is too large' });
    },
  });

  api.get('/health', (c) => c.json({ status: 'ok' }));

  api.post('/identify', uploadLimit, async (c) => {
    const { image } = await readUpload(c);
    return c.json(await identify.identify(image));
  });

  api.post('/containers', async (c) => {
    const input = await readJson(c, RegisterContainerSchema);
    return c.json(handovers.registerContainer(input), 201);
  });

  api.get('/containers/:number', async (c) =>
    c.json(await handovers.history(c.req.param('number'))),
  );

  api.post('/handovers', async (c) => {
    const input = await readJson(c, StartHandoverSchema);
    return c.json(handovers.start(input), 201);
  });

  api.get('/handovers/:id', (c) => c.json(handovers.detail(c.req.param('id'))));

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

  api.put('/handovers/:id/photos/:photoId/corners', async (c) => {
    const { corners } = await readJson(c, UpdateCornersSchema);
    return c.json(handovers.updateCorners(c.req.param('id'), c.req.param('photoId'), corners));
  });

  api.post('/handovers/:id/marks', async (c) => {
    const input = await readJson(c, CreateMarkSchema);
    return c.json(handovers.addMark(c.req.param('id'), input), 201);
  });

  api.patch('/handovers/:id/marks/:markId', async (c) => {
    const patch = await readJson(c, UpdateMarkSchema);
    return c.json(handovers.updateMark(c.req.param('id'), c.req.param('markId'), patch));
  });

  api.post('/handovers/:id/close', async (c) => c.json(await handovers.close(c.req.param('id'))));

  api.all('*', (c) => problem(c, 404, 'not-found', `No route for ${c.req.method} ${c.req.path}`));
  return api;
}

function serveWebApp(app: Hono, root: string): void {
  app.use('/*', serveStatic({ root }));
  // Client-side routes: anything that isn't a file gets the app shell.
  let shell: Promise<string> | undefined;
  app.get('*', async (c) => {
    shell ??= readFile(join(root, 'index.html'), 'utf8');
    c.header('cache-control', 'no-cache');
    return c.html(await shell);
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
