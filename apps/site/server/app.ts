/**
 * The site's HTTP server: the built pages and assets, and POST /api/waitlist.
 * The form answers JSON to the page's script and whole pages to browsers
 * posting without it.
 */

import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { secureHeaders } from 'hono/secure-headers';
import { type Page, type RenderContext, renderDocument } from '../src/layout.ts';
import { checkFormPage, thankYouPage, tooManyRequestsPage } from '../src/pages/responses.ts';
import type { FormState, TextField } from '../src/waitlist.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { WaitlistStore } from './store.ts';
import { type FieldIssue, isHoneypotFilled, isTicked, parseSubmission } from './submission.ts';

export interface SiteAppDeps {
  /** The folder of built pages and assets to serve. */
  readonly publicDir: string;
  /** Sent, with status 404, for anything that isn't there. */
  readonly notFoundHtml: string;
  /** For the pages the server renders itself. */
  readonly render: RenderContext;
  readonly store: Pick<WaitlistStore, 'save'>;
  readonly limiter: Pick<RateLimiter, 'hit'>;
  /** Who is asking, for the rate limit. */
  readonly clientOf: (c: Context) => string;
  readonly now?: () => Date;
  readonly onError?: (error: unknown) => void;
}

/** A form is a few hundred bytes; anything much bigger isn't one. */
const MAX_BODY_BYTES = 16 * 1024;

const PROBLEM_TYPE = 'https://plomba.dev/problems';

export function createSiteApp(deps: SiteAppDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const page = (c: Context, p: Page, status: 200 | 400 | 429 = 200) =>
    c.html(renderDocument(p, deps.render), status, { 'cache-control': 'no-store' });

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: {
        camera: false,
        microphone: false,
        geolocation: false,
        payment: false,
        usb: false,
      },
    }),
  );
  app.use(compress());
  // Lets browsers revalidate a page with a 304 instead of downloading it again.
  app.use(etag({ weak: true }));

  app.post(
    '/api/waitlist',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => problem(c, 413, 'too-large', 'The form is too large to be a waitlist entry.'),
    }),
    async (c) => {
      const json = wantsJson(c);

      const limit = deps.limiter.hit(deps.clientOf(c));
      if (!limit.allowed) {
        c.header('retry-after', String(limit.retryAfterSeconds));
        const minutes = Math.ceil(limit.retryAfterSeconds / 60);
        return json
          ? problem(
              c,
              429,
              'rate-limited',
              `Too many attempts. Please try again in ${minutes} min.`,
            )
          : page(c, tooManyRequestsPage(limit.retryAfterSeconds), 429);
      }

      const input = await readFields(c);
      // Bots get the same answer as people, so they can't tell they were caught.
      if (isHoneypotFilled(input)) {
        return json ? c.json({ status: 'ok' }) : page(c, thankYouPage());
      }

      const result = parseSubmission(input);
      if (!result.ok) {
        return json
          ? problem(c, 400, 'invalid-submission', 'Please check the form.', result.issues)
          : page(c, checkFormPage(formState(input, result.issues)), 400);
      }

      deps.store.save(result.lead, now());
      return json ? c.json({ status: 'ok' }) : page(c, thankYouPage(result.lead.name));
    },
  );

  app.all('/api/*', (c) => problem(c, 404, 'not-found', 'There is nothing here.'));

  app.use('/*', async (c, next) => {
    await next();
    if (c.res.status === 200 && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      c.header('cache-control', cacheControl(c.req.path));
    }
  });
  app.use('/*', serveStatic({ root: deps.publicDir }));

  app.notFound((c) => c.html(deps.notFoundHtml, 404, { 'cache-control': 'no-cache' }));

  app.onError((error, c) => {
    deps.onError?.(error);
    return wantsJson(c)
      ? problem(c, 500, 'internal', 'Something went wrong on our side.')
      : c.text('Something went wrong on our side. Please try again later.', 500);
  });

  return app;
}

/**
 * Built assets live under a content hash and never change. Images may be
 * replaced, so they're kept for a day; pages are checked on every visit.
 */
function cacheControl(path: string): string {
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (path.startsWith('/images/')) return 'public, max-age=86400';
  return 'no-cache';
}

/** The page's script asks for JSON; a plain form post asks for HTML. */
function wantsJson(c: Context): boolean {
  const accept = c.req.header('accept') ?? '';
  const type = c.req.header('content-type') ?? '';
  return (
    type.includes('application/json') ||
    (accept.includes('application/json') && !accept.includes('text/html'))
  );
}

async function readFields(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body: unknown = await c.req.json();
      return typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    }
    if (
      type.includes('multipart/form-data') ||
      type.includes('application/x-www-form-urlencoded')
    ) {
      return await c.req.parseBody();
    }
  } catch {
    // A malformed body is treated as an empty form, and fails validation as one.
  }
  return {};
}

/** What the visitor typed, to fill the form in again, with a message per field. */
function formState(
  input: Readonly<Record<string, unknown>>,
  issues: readonly FieldIssue[],
): FormState {
  const text = (name: TextField) =>
    typeof input[name] === 'string' ? (input[name] as string) : '';
  return {
    values: {
      name: text('name'),
      company: text('company'),
      role: text('role'),
      email: text('email'),
      message: text('message'),
      consent: isTicked(input.consent),
    },
    errors: Object.fromEntries(issues.map((issue) => [issue.path, issue.message])),
  };
}

/** RFC 9457 problem details, as the Plomba app's own API reports errors. */
function problem(
  c: Context,
  status: 400 | 404 | 413 | 429 | 500,
  type: string,
  title: string,
  issues?: readonly FieldIssue[],
) {
  return c.json(
    { type: `${PROBLEM_TYPE}/${type}`, title, status, ...(issues ? { issues } : {}) },
    status,
    {
      'content-type': 'application/problem+json',
    },
  );
}
