import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createSiteApp } from '../server/app.ts';
import { RateLimiter } from '../server/rate-limit.ts';
import { WaitlistStore } from '../server/store.ts';
import { useBuiltSite } from './built-site.ts';

const site = useBuiltSite();

const VALID = {
  name: 'Anna Nowak',
  company: 'Port Łódź',
  role: 'terminal-depot',
  email: 'anna@example.com',
  message: '',
  consent: 'yes',
};

function setup({ limit = 5 } = {}) {
  const { publicDir, notFoundHtml, render } = site();
  const store = WaitlistStore.open(':memory:');
  const app = createSiteApp({
    publicDir,
    notFoundHtml,
    render,
    store,
    limiter: new RateLimiter({ limit, windowMs: 10 * 60_000 }),
    // Tests name the client in a header; the server takes it from the socket.
    clientOf: (c) => c.req.header('x-test-client') ?? 'client',
    now: () => new Date('2026-11-03T12:00:00Z'),
  });
  return { app, store };
}

/** A browser without JavaScript posting the form. */
const postForm = (app: Hono, fields: Record<string, string>, client?: string) =>
  app.request('/api/waitlist', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      ...(client ? { 'x-test-client': client } : {}),
    },
    body: new URLSearchParams(fields),
  });

/** The page's script: the same form fields, asking for JSON. */
const postFromScript = (app: Hono, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return app.request('/api/waitlist', {
    method: 'POST',
    headers: { accept: 'application/json' },
    body,
  });
};

/** The page as a reader sees it: the template escapes apostrophes. */
const textOf = async (response: Response) => (await response.text()).replaceAll('&#39;', "'");

const postJson = (app: Hono, body: unknown) =>
  app.request('/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/waitlist', () => {
  it('stores a lead sent by the page script and answers JSON', async () => {
    const { app, store } = setup();
    const response = await postFromScript(app, VALID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(store.list()).toMatchObject([
      { email: 'anna@example.com', role: 'terminal-depot', createdAt: '2026-11-03T12:00:00.000Z' },
    ]);
  });

  it('accepts a JSON body', async () => {
    const { app, store } = setup();
    const response = await postJson(app, { ...VALID, consent: true });
    expect(response.status).toBe(200);
    expect(store.list()).toHaveLength(1);
  });

  it('answers a plain form post with a thank-you page, escaping what was typed', async () => {
    const { app, store } = setup();
    const response = await postForm(app, { ...VALID, name: '<script>alert(1)</script>' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const page = await textOf(response);
    expect(page).toContain("You're on the waitlist");
    expect(page).toContain('Thank you, &lt;script&gt;alert(1)&lt;/script&gt;.');
    expect(page).not.toContain('<script>alert(1)');
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(store.list()).toHaveLength(1);
  });

  it('reports invalid fields to the script as problem details', async () => {
    const { app, store } = setup();
    const response = await postFromScript(app, { ...VALID, email: 'anna@example', consent: '' });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({
      status: 400,
      title: 'Please check the form.',
      issues: [
        { path: 'email', message: 'Enter an email address like name@company.com' },
        { path: 'consent', message: 'Tick the box so we may store your details' },
      ],
    });
    expect(store.list()).toEqual([]);
  });

  it('sends the form back, filled in and with its errors, to a browser without JavaScript', async () => {
    const { app } = setup();
    const response = await postForm(app, { ...VALID, company: 'A "quoted" <co>', email: 'nope' });
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('Please check the form');
    expect(page).toContain('value="A &quot;quoted&quot; &lt;co&gt;"');
    expect(page).toContain('<option value="terminal-depot" selected>');
    expect(page).toMatch(
      /id="waitlist-email"[^>]*aria-describedby="waitlist-email-error"[^>]*aria-invalid="true"/,
    );
    expect(page).toContain(
      'href="#waitlist-email">Enter an email address like name@company.com</a>',
    );
  });

  it('pretends to accept a bot that fills in the honeypot, and stores nothing', async () => {
    const { app, store } = setup();
    const fromScript = await postFromScript(app, { ...VALID, website: 'https://spam.example' });
    expect(fromScript.status).toBe(200);
    expect(await fromScript.json()).toEqual({ status: 'ok' });

    const fromForm = await postForm(app, { ...VALID, website: 'https://spam.example' });
    expect(fromForm.status).toBe(200);
    expect(await textOf(fromForm)).toContain("You're on the waitlist");

    expect(store.list()).toEqual([]);
  });

  it('refuses a client that sends too often, but not other clients', async () => {
    const { app, store } = setup({ limit: 2 });
    for (let i = 0; i < 2; i++) {
      expect((await postForm(app, { ...VALID, email: `anna${i}@example.com` }, 'a')).status).toBe(
        200,
      );
    }
    const refused = await postForm(app, VALID, 'a');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBe(600);
    expect(await refused.text()).toContain('Too many attempts');

    const other = await postForm(app, { ...VALID, email: 'jan@example.com' }, 'b');
    expect(other.status).toBe(200);
    expect(store.list()).toHaveLength(3);
  });

  it('tells the script when it is rate-limited', async () => {
    const { app } = setup({ limit: 1 });
    await postFromScript(app, VALID);
    const refused = await postFromScript(app, VALID);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ status: 429 });
  });

  it('refuses bodies far bigger than a form', async () => {
    const { app } = setup();
    const response = await postJson(app, { ...VALID, message: 'x'.repeat(40_000) });
    expect(response.status).toBe(413);
  });
});

describe('serving the site', () => {
  it('serves the pages, revalidated on every visit', async () => {
    const { app } = setup();
    const response = await app.request('/integrations/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers a repeat visit with 304 Not Modified', async () => {
    const { app } = setup();
    const first = await app.request('/privacy/');
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const again = await app.request('/privacy/', { headers: { 'if-none-match': etag ?? '' } });
    expect(again.status).toBe(304);
    expect(again.headers.get('cache-control')).toBe('no-cache');
  });

  it('lets browsers keep the hashed assets for good', async () => {
    const { app } = setup();
    const response = await app.request(site().render.assets.stylesheet);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('sets a strict content security policy and other security headers', async () => {
    const { app } = setup();
    for (const path of ['/', '/api/waitlist']) {
      const response = await app.request(path);
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(response.headers.get('permissions-policy')).toContain('camera=()');
    }
  });

  it('answers unknown pages with the 404 page', async () => {
    const { app } = setup();
    const response = await app.request('/no/such/page/');
    expect(response.status).toBe(404);
    expect(await textOf(response)).toContain("We couldn't find that page");
  });

  it('answers unknown API requests with problem details', async () => {
    const { app } = setup();
    const response = await app.request('/api/waitlist');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
  });

  it('does not serve what only the server needs', async () => {
    const { app } = setup();
    expect((await app.request('/render-context.json')).status).toBe(404);
    expect((await app.request('/../render-context.json')).status).toBe(404);
  });
});
