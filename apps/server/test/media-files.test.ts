import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileMediaStore } from '../src/media/file-media-store.ts';
import { JsonFileCache } from '../src/media/json-file-cache.ts';

function folder(): string {
  return mkdtempSync(join(tmpdir(), 'plomba-media-'));
}

/** Every file under `dir`, recursively, as paths relative to it. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
}

describe('FileMediaStore', () => {
  it('stores the same photo uploaded several times at once, leaving no temporary files', async () => {
    const root = folder();
    const store = new FileMediaStore(root);
    const photo = new Uint8Array(256 * 1024).fill(7);

    const stored = await Promise.all(Array.from({ length: 8 }, () => store.put(photo)));

    expect(new Set(stored.map((s) => s.sha256)).size).toBe(1);
    expect(await store.get(stored[0]?.sha256 ?? '')).toEqual(photo);
    expect(files(root)).toEqual([
      join(
        stored[0]?.sha256.slice(0, 2) ?? '',
        stored[0]?.sha256.slice(2, 4) ?? '',
        stored[0]?.sha256 ?? '',
      ),
    ]);
  });
});

describe('JsonFileCache', () => {
  it('takes the same result written several times at once, leaving no temporary files', async () => {
    const root = folder();
    const cache = new JsonFileCache<{ frames: number }>(root);
    const key = 'a'.repeat(64);

    await Promise.all(Array.from({ length: 8 }, () => cache.put(key, { frames: 180 })));

    expect(await cache.get(key)).toEqual({ frames: 180 });
    expect(files(root)).toEqual([`${key}.json`]);
  });
});
