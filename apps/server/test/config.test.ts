import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseApiTokens } from '../src/config.ts';

describe('loadConfig', () => {
  it('reads the key from a file and applies defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plomba-config-'));
    writeFileSync(join(dir, 'meta.key'), 'LLM_test_secret\n');
    const config = loadConfig({ META_API_KEY_FILE: join(dir, 'meta.key') });
    expect(config.meta.apiKey).toBe('LLM_test_secret');
    expect(config.meta.visionModel).toBe('muse-spark-1.3');
    expect(config.port).toBe(8080);
    expect(config.accessCode).toBeUndefined();
  });

  it('treats empty variables as unset, as compose passes them', () => {
    const config = loadConfig({ META_API_KEY: 'k', PLOMBA_ACCESS_CODE: '', PORT: '' });
    expect(config.accessCode).toBeUndefined();
    expect(config.port).toBe(8080);
  });

  it('lists every invalid variable at once', () => {
    expect(() =>
      loadConfig({ META_API_KEY: 'k', PORT: 'eighty', PLOMBA_ACCESS_CODE: 'short' }),
    ).toThrow(/PORT[\s\S]*PLOMBA_ACCESS_CODE/);
  });

  it('asks for a key', () => {
    expect(() => loadConfig({})).toThrow(/META_API_KEY_FILE/);
  });

  it('reports a key file it cannot read', () => {
    expect(() => loadConfig({ META_API_KEY_FILE: '/nonexistent/meta.key' })).toThrow(ConfigError);
  });

  it('keeps the Meta key away from a separate vision endpoint', () => {
    const config = loadConfig({
      META_API_KEY: 'meta-secret',
      META_VISION_BASE_URL: 'http://glimmer.local:11434/v1/',
      META_VISION_API_STYLE: 'chat-completions',
    });
    expect(config.meta.vision).toEqual({
      baseUrl: 'http://glimmer.local:11434/v1',
      apiKey: undefined,
      apiStyle: 'chat-completions',
      maxImages: 16,
    });
  });

  it('reads API tokens as name and token per line, and refuses weak or repeated ones', () => {
    expect(
      parseApiTokens(
        `# integrations\nclaims-desk ${'a'.repeat(24)}\n\nrail-tos ${'b'.repeat(30)}\n`,
      ),
    ).toEqual([
      { name: 'claims-desk', token: 'a'.repeat(24) },
      { name: 'rail-tos', token: 'b'.repeat(30) },
    ]);
    expect(() => parseApiTokens('claims-desk short')).toThrow(ConfigError);
    expect(() => parseApiTokens(`a ${'x'.repeat(24)}\na ${'y'.repeat(24)}`)).toThrow(ConfigError);
  });

  it('needs a signing secret for webhooks, and http(s) URLs', () => {
    const base = { META_API_KEY: 'k' };
    expect(() =>
      loadConfig({ ...base, PLOMBA_WEBHOOK_URLS: 'https://a.example.com/hook' }),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({
        ...base,
        PLOMBA_WEBHOOK_URLS: 'ftp://a.example.com',
        PLOMBA_WEBHOOK_SECRET: 's'.repeat(32),
      }),
    ).toThrow(ConfigError);
    const config = loadConfig({
      ...base,
      PLOMBA_WEBHOOK_URLS: 'https://a.example.com/hook, https://b.example.com/hook',
      PLOMBA_WEBHOOK_SECRET: 's'.repeat(32),
    });
    expect(config.webhooks?.urls).toEqual([
      'https://a.example.com/hook',
      'https://b.example.com/hook',
    ]);
  });
});
