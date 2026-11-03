/**
 * Optional access control for installations without a single-sign-on proxy:
 * one shared access code, exchanged for a signed session cookie. A cookie
 * (not a header) because photos are loaded by <img> tags.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { LoginSchema } from '@plomba/contracts';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { UnauthorizedError, ValidationError } from '../errors.ts';

export const SESSION_COOKIE = 'plomba_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
/** Slows down guessing; the code itself should be long. */
const WRONG_CODE_DELAY_MS = 750;

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Requests that never need a session. */
const PUBLIC_PATHS = new Set(['/api/health', '/api/session', '/api/instance']);

/** Adds the session routes and protects /api and /media. Without a code, everything stays open. */
export function installAccessControl(app: Hono, accessCode: string | undefined): void {
  // Changing the code invalidates every session signed with the old one.
  const secret = accessCode ? digest(`plomba-session:${accessCode}`).toString('hex') : '';

  const isAuthenticated = async (c: Context): Promise<boolean> => {
    if (!accessCode) return true;
    const value = await getSignedCookie(c, secret, SESSION_COOKIE);
    return typeof value === 'string' && Number(value) > Date.now() / 1000;
  };

  app.get('/api/session', async (c) =>
    c.json({ required: accessCode !== undefined, authenticated: await isAuthenticated(c) }),
  );

  app.post('/api/session', async (c) => {
    if (!accessCode) return c.body(null, 204);
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new ValidationError('Send the access code as {"code": "…"}');
    if (!timingSafeEqual(digest(parsed.data.code), digest(accessCode))) {
      await new Promise((resolve) => setTimeout(resolve, WRONG_CODE_DELAY_MS));
      throw new UnauthorizedError('That access code is not right');
    }
    const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    await setSignedCookie(c, SESSION_COOKIE, String(expires), secret, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_SECONDS,
      secure: isHttps(c),
    });
    return c.body(null, 204);
  });

  app.delete('/api/session', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  const guard: MiddlewareHandler = async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path) || (await isAuthenticated(c))) return next();
    throw new UnauthorizedError('Enter the access code first');
  };
  app.use('/api/*', guard);
  app.use('/media/*', guard);
}

/** Directly, or behind a TLS-terminating proxy that sets X-Forwarded-Proto. */
function isHttps(c: Context): boolean {
  return c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
}
