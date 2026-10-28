import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

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
});
