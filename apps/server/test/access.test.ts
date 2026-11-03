import { describe, expect, it } from 'vitest';
import { createTestApp } from './fakes.ts';

function app(accessCode?: string) {
  return createTestApp(accessCode === undefined ? {} : { accessCode }).app;
}

const login = (code: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code }),
});

describe('access control', () => {
  it('leaves everything open when no access code is configured', async () => {
    const open = app();
    expect((await open.request('/api/handovers')).status).toBe(200);
    expect(await (await open.request('/api/session')).json()).toEqual({
      required: false,
      authenticated: true,
    });
  });

  it('needs a session for the API and media, but not for health', async () => {
    const guarded = app('correct horse battery');
    expect((await guarded.request('/api/health')).status).toBe(200);
    expect((await guarded.request('/api/handovers')).status).toBe(401);
    expect((await guarded.request(`/media/${'a'.repeat(64)}`)).status).toBe(401);
    expect(await (await guarded.request('/api/session')).json()).toEqual({
      required: true,
      authenticated: false,
    });
  });

  it("shows the operator's notice to everyone, before the access code", async () => {
    const { app: guarded } = createTestApp({
      accessCode: 'correct horse battery',
      notice: 'Demo data. Photos: Cowboy Steve Builds, CC BY 3.0.',
    });
    const response = await guarded.request('/api/instance');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notice: 'Demo data. Photos: Cowboy Steve Builds, CC BY 3.0.',
    });
    expect(await (await app().request('/api/instance')).json()).toEqual({ notice: null });
  });

  it('lets other systems in with an API token, and no one with a wrong one', async () => {
    const { app: guarded } = createTestApp({
      accessCode: 'correct horse battery',
      apiTokens: [{ name: 'claims-desk', token: 'a'.repeat(32) }],
    });
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
    expect((await guarded.request('/api/handovers', bearer('a'.repeat(32)))).status).toBe(200);
    expect((await guarded.request('/api/handovers', bearer('b'.repeat(32)))).status).toBe(401);
    expect((await guarded.request('/api/handovers')).status).toBe(401);
  });

  it('rejects a wrong code', async () => {
    const response = await app('correct horse battery').request('/api/session', login('guess'));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('exchanges the right code for an HttpOnly session cookie', async () => {
    const guarded = app('correct horse battery');
    const response = await guarded.request('/api/session', login('correct horse battery'));
    expect(response.status).toBe(204);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^plomba_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const headers = { cookie: cookie.split(';')[0] ?? '' };
    expect((await guarded.request('/api/handovers', { headers })).status).toBe(200);
    expect(await (await guarded.request('/api/session', { headers })).json()).toEqual({
      required: true,
      authenticated: true,
    });
  });

  it('does not accept a cookie signed for another code', async () => {
    const first = await app('first access code').request(
      '/api/session',
      login('first access code'),
    );
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const response = await app('second access code').request('/api/handovers', {
      headers: { cookie },
    });
    expect(response.status).toBe(401);
  });
});
