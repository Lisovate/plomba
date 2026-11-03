import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SampleClipsSchema } from '@plomba/contracts';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.ts';
import { SampleClips } from '../src/media/sample-clips.ts';
import { createTestApp } from './fakes.ts';

function folder(manifest: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'plomba-samples-'));
  writeFileSync(join(dir, 'samples.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const rusty = {
  file: 'rusty-side.mp4',
  title: 'Rusty 40 ft side on a trailer',
  credit: 'Cowboy Steve Builds, CC BY 3.0',
};

describe('SampleClips', () => {
  it('lists the clips in samples.json that exist, with their credits', () => {
    const dir = folder([rusty, { ...rusty, file: 'missing.mp4' }], { 'rusty-side.mp4': 'mp4' });
    expect(SampleClips.load(dir).list()).toEqual([
      {
        title: rusty.title,
        credit: rusty.credit,
        sourceUrl: null,
        url: '/api/samples/rusty-side.mp4',
      },
    ]);
  });

  it('serves only listed files', async () => {
    const dir = folder([rusty], { 'rusty-side.mp4': 'mp4', 'secret.mp4': 'no' });
    const samples = SampleClips.load(dir);
    expect((await samples.read('rusty-side.mp4'))?.mimeType).toBe('video/mp4');
    expect(await samples.read('secret.mp4')).toBeNull();
    expect(await samples.read('../samples.json')).toBeNull();
  });

  it('refuses a manifest that names files outside the folder', () => {
    expect(() => SampleClips.load(folder([{ ...rusty, file: '../etc/passwd.mp4' }]))).toThrow(
      ConfigError,
    );
  });
});

describe('GET /api/samples', () => {
  it('lists and serves the clips, and 404s for anything else', async () => {
    const dir = folder([rusty], { 'rusty-side.mp4': 'mp4 bytes' });
    const { app } = createTestApp({ samples: SampleClips.load(dir) });
    const list = SampleClipsSchema.parse(await (await app.request('/api/samples')).json());
    expect(list.map((clip) => clip.title)).toEqual([rusty.title]);
    const clip = await app.request(list[0]?.url ?? '');
    expect(clip.headers.get('content-type')).toBe('video/mp4');
    expect(await clip.text()).toBe('mp4 bytes');
    expect((await app.request('/api/samples/secret.mp4')).status).toBe(404);
  });

  it('is empty when the installation offers no samples', async () => {
    const { app } = createTestApp();
    expect(await (await app.request('/api/samples')).json()).toEqual([]);
  });
});
