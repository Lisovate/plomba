import { describe, expect, it } from 'vitest';
import {
  SqliteContainerRepository,
  SqliteHandoverRepository,
  SqliteMarkRepository,
  SqlitePhotoRepository,
} from '../src/adapters/sqlite/repositories.ts';
import { createApp } from '../src/http/app.ts';
import { ClaimService } from '../src/services/claims.ts';
import { IdentifyService } from '../src/services/identify.ts';
import { SpeechService } from '../src/services/speech.ts';
import {
  createTestHandoverService,
  FakeReader,
  FakeTranscriber,
  ScriptedAgent,
  silentLogger,
} from './fakes.ts';

function app(accessCode?: string) {
  const { service, media, db } = createTestHandoverService();
  return createApp({
    identify: new IdentifyService(new FakeReader(null)),
    handovers: service,
    speech: new SpeechService(new FakeTranscriber()),
    claims: new ClaimService({
      containers: new SqliteContainerRepository(db),
      handovers: new SqliteHandoverRepository(db),
      photos: new SqlitePhotoRepository(db),
      marks: new SqliteMarkRepository(db),
      media,
      agent: new ScriptedAgent([]),
    }),
    media,
    logger: silentLogger,
    accessCode,
  });
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
