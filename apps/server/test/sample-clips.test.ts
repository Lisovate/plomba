import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SampleClipsSchema, SamplesSchema } from '@plomba/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.ts';
import { SampleClips } from '../src/media/sample-clips.ts';
import { createTestApp } from './fakes.ts';

const folders: string[] = [];
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(manifest: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'plomba-samples-'));
  folders.push(dir);
  writeFileSync(join(dir, 'samples.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const rusty = {
  file: 'rusty-side.mp4',
  title: 'Rusty 40 ft side on a trailer',
  credit: 'Cowboy Steve Builds, CC BY 3.0',
};
const doors = { ...rusty, file: 'doors.jpg', title: 'Door markings', use: 'doors' };

// The class name remains compatible with existing installation wiring.
describe('SampleClips', () => {
  it('accepts the original clip manifest and leaves out missing files', () => {
    const dir = folder([rusty, { ...rusty, file: 'missing.mp4' }], { 'rusty-side.mp4': 'mp4' });
    const list = SampleClips.load(dir).list();
    expect(list).toEqual([
      {
        title: rusty.title,
        credit: rusty.credit,
        sourceUrl: null,
        url: '/api/samples/rusty-side.mp4',
        kind: 'clip',
        use: null,
        containerNumber: null,
      },
    ]);
    // Existing API consumers can still parse the fields they used before.
    expect(SampleClipsSchema.parse(list)[0]?.title).toBe(rusty.title);
  });

  it('lists clips and JPEG photos with their roles, credits and optional container links', () => {
    const entries = [
      { ...rusty, containerNumber: 'CSQU3054383', sourceUrl: 'https://example.com/clip' },
      { ...rusty, file: 'corner.MOV' },
      doors,
      ...['D', 'R', 'F', 'L', 'T'].map((use) => ({ ...doors, file: `${use}.JPEG`, use })),
    ];
    const dir = folder(entries, Object.fromEntries(entries.map((e) => [e.file, 'sample'])));
    const list = SamplesSchema.parse(SampleClips.load(dir).list());
    expect(list.map((s) => s.kind)).toEqual(['clip', 'clip', ...Array(6).fill('photo')]);
    expect(list.map((s) => s.use)).toEqual([null, null, 'doors', 'D', 'R', 'F', 'L', 'T']);
    expect(list[0]).toMatchObject({
      containerNumber: 'CSQU3054383',
      sourceUrl: 'https://example.com/clip',
    });
    expect(list.every((s) => s.credit === rusty.credit)).toBe(true);
  });

  it.each([
    ['MP4', rusty, 'video/mp4'],
    ['MOV', { ...rusty, file: 'clip.MOV' }, 'video/quicktime'],
    ['JPG', doors, 'image/jpeg'],
    ['JPEG', { ...doors, file: 'doors.JPEG' }, 'image/jpeg'],
  ])('serves %s with the correct media type', async (_name, entry, mimeType) => {
    const samples = SampleClips.load(folder([entry], { [entry.file]: 'bytes' }));
    expect(await samples.read(entry.file)).toEqual({
      data: new TextEncoder().encode('bytes'),
      mimeType,
    });
  });

  it('serves only listed files, including for photos', async () => {
    const samples = SampleClips.load(folder([doors], { 'doors.jpg': 'jpeg', 'secret.jpg': 'no' }));
    expect(await samples.read('secret.jpg')).toBeNull();
    expect(await samples.read('../samples.json')).toBeNull();
    expect(await samples.read('/etc/passwd')).toBeNull();
  });

  it.each([
    { ...rusty, file: '../outside.mp4' },
    { ...rusty, file: '/outside.mp4' },
    { ...rusty, file: 'nested/clip.mp4' },
    { ...rusty, file: 'nested\\clip.mp4' },
    { ...rusty, file: 'photo.png' },
    { ...doors, use: undefined },
    { ...doors, use: null },
    { ...doors, use: 'B' },
    { ...rusty, use: 'D' },
    { ...rusty, containerNumber: 'CSQU3054384' },
    { ...rusty, containerNumber: 'not a container' },
    { ...rusty, containerNumber: 'CSQU 305438 3' },
    { ...rusty, title: '' },
    { ...rusty, credit: '' },
    { ...rusty, sourceUrl: 'not a URL' },
  ])('rejects a bad manifest entry: %j', (entry) => {
    expect(() => SampleClips.load(folder([entry]))).toThrow(ConfigError);
  });

  it('rejects duplicate file names and malformed manifests', () => {
    expect(() => SampleClips.load(folder([rusty, rusty]))).toThrow(ConfigError);
    expect(() => SampleClips.load(folder({ samples: [rusty] }))).toThrow(ConfigError);
    const dir = folder([]);
    writeFileSync(join(dir, 'samples.json'), '{broken');
    expect(() => SampleClips.load(dir)).toThrow(ConfigError);
  });

  it('rejects a listed symlink to a file outside the samples folder', () => {
    const outside = folder([], { 'outside.jpg': 'private' });
    const dir = folder([doors]);
    symlinkSync(join(outside, 'outside.jpg'), join(dir, 'doors.jpg'));
    expect(() => SampleClips.load(dir)).toThrow(ConfigError);
  });
});

describe('GET /api/samples', () => {
  it('lists and serves clips and photos, and 404s for anything else', async () => {
    const dir = folder([rusty, { ...doors, containerNumber: 'CSQU3054383' }], {
      'rusty-side.mp4': 'mp4 bytes',
      'doors.jpg': 'jpeg bytes',
      'secret.jpg': 'private',
    });
    const { app } = createTestApp({ samples: SampleClips.load(dir) });
    const list = SamplesSchema.parse(await (await app.request('/api/samples')).json());
    expect(list.map((s) => s.kind)).toEqual(['clip', 'photo']);
    expect(list[1]).toMatchObject({ use: 'doors', containerNumber: 'CSQU3054383' });
    for (const [index, type, bytes] of [
      [0, 'video/mp4', 'mp4 bytes'],
      [1, 'image/jpeg', 'jpeg bytes'],
    ] as const) {
      const response = await app.request(list[index]?.url ?? '');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(type);
      expect(await response.text()).toBe(bytes);
    }
    expect((await app.request('/api/samples/secret.jpg')).status).toBe(404);
    expect((await app.request('/api/samples/samples.json')).status).toBe(404);
    expect((await app.request('/api/samples/..%2Foutside.jpg')).status).toBe(404);
  });

  it('keeps samples behind the installation access code', async () => {
    const dir = folder([doors], { 'doors.jpg': 'jpeg' });
    const { app } = createTestApp({
      samples: SampleClips.load(dir),
      accessCode: 'correct horse battery',
    });
    expect((await app.request('/api/samples')).status).toBe(401);
    expect((await app.request('/api/samples/doors.jpg')).status).toBe(401);
  });

  it('is empty when the installation offers no samples', async () => {
    const { app } = createTestApp();
    expect(await (await app.request('/api/samples')).json()).toEqual([]);
    expect((await app.request('/api/samples/doors.jpg')).status).toBe(404);
  });
});
