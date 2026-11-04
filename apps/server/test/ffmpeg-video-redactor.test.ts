import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  FfmpegVideoRedactor,
  videoRedactionAvailable,
} from '../src/media/ffmpeg-video-redactor.ts';
import { videoFrameCount } from '../src/media/mp4.ts';
import { videoContentType } from '../src/media/video.ts';
import { FakeSegmenter, rectangleObject } from './fakes.ts';

const exec = promisify(execFile);
const fixture = new URL('../../../e2e/fixtures/container-side.mp4', import.meta.url);
const available = await videoRedactionAvailable();

async function temporaryClips() {
  return (await readdir(tmpdir())).filter((file) => file.startsWith('plomba-blur-')).sort();
}

async function probe(file: string) {
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-show_streams',
    '-of',
    'json',
    file,
  ]);
  return JSON.parse(stdout) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width: number;
      height: number;
      nb_read_frames: string;
      avg_frame_rate: string;
      pix_fmt: string;
      tags?: Record<string, string>;
    }[];
  };
}

/** Fine detail inside the fake privacy box; blurring should remove it. */
async function detail(file: string): Promise<number> {
  const { stdout } = await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-frames:v',
      '1',
      '-threads',
      '1',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
  );
  const pixels = await sharp(stdout)
    .extract({ left: 200, top: 200, width: 600, height: 300 })
    .greyscale()
    .raw()
    .toBuffer();
  let total = 0;
  for (let i = 0; i < pixels.length - 1; i++) {
    if (i % 600 !== 599) total += Math.abs((pixels[i] ?? 0) - (pixels[i + 1] ?? 0));
  }
  return total / pixels.length;
}

describe.skipIf(!available)('FfmpegVideoRedactor', () => {
  it('blurs tracked boxes and keeps MP4 frames, rate and size, with H.264, faststart and no audio or source metadata', async () => {
    const before = await temporaryClips();
    const dir = await mkdtemp(join(tmpdir(), 'plomba-redactor-test-'));
    try {
      const source = join(dir, 'with-audio.mp4');
      await exec('ffmpeg', [
        '-v',
        'error',
        '-i',
        fixture.pathname,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-shortest',
        '-metadata:s:v:0',
        'handler_name=private',
        source,
      ]);
      expect((await probe(source)).streams.map((stream) => stream.codec_type)).toContain('audio');
      const segmenter = new FakeSegmenter();
      const object = rectangleObject(100, 100, 1000, 600);
      segmenter.tracked = [
        { frame: 0, objects: [object] },
        { frame: 19, objects: [object] },
      ];
      const data = new Uint8Array(await readFile(source));
      const result = await new FfmpegVideoRedactor(segmenter).redact({
        data,
        mimeType: 'video/mp4',
      });
      const output = join(dir, 'redacted.mp4');
      await writeFile(output, result.data);

      expect(segmenter.calls).toEqual(['track:person', 'track:license plate']);
      expect(result.mimeType).toBe('video/mp4');
      expect(videoContentType(result.data)).toBe('video/mp4');
      expect(result.regions).toBe(4);
      expect(videoFrameCount(result.data)).toBe(videoFrameCount(data));
      const original = (await probe(source)).streams[0];
      expect(original).toBeDefined();
      expect(original?.tags?.handler_name).toBe('private');
      const streams = (await probe(output)).streams;
      expect(streams).toHaveLength(1);
      expect(streams[0]).toMatchObject({
        codec_type: 'video',
        codec_name: 'h264',
        pix_fmt: 'yuv420p',
        width: original?.width,
        height: original?.height,
        nb_read_frames: original?.nb_read_frames,
        avg_frame_rate: original?.avg_frame_rate,
      });
      expect(streams[0]?.tags?.handler_name).not.toBe('private');
      const bytes = Buffer.from(result.data);
      expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'));
      expect(await detail(output)).toBeLessThan((await detail(source)) * 0.5);
      expect(await temporaryClips()).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('converts WebM to MP4 for SAM and preserves the decoded frames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plomba-redactor-test-'));
    try {
      const source = join(dir, 'source.webm');
      await exec('ffmpeg', [
        '-v',
        'error',
        '-i',
        fixture.pathname,
        '-c:v',
        'libvpx-vp9',
        '-threads',
        '2',
        source,
      ]);
      const segmenter = new FakeSegmenter();
      vi.spyOn(segmenter, 'track').mockImplementation(async (video) => {
        expect(video.mimeType).toBe('video/mp4');
        expect(videoContentType(video.data)).toBe('video/mp4');
        expect(videoFrameCount(video.data)).toBe(20);
        return [];
      });
      const result = await new FfmpegVideoRedactor(segmenter).redact({
        data: new Uint8Array(await readFile(source)),
        mimeType: 'video/webm',
      });
      const output = join(dir, 'redacted.mp4');
      await writeFile(output, result.data);
      expect(videoFrameCount(result.data)).toBe(20);
      expect((await probe(output)).streams[0]).toMatchObject({ width: 1200, height: 800 });
      expect(result.regions).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('removes temporary originals after model and decoder failures', async () => {
    const before = await temporaryClips();
    const segmenter = new FakeSegmenter();
    vi.spyOn(segmenter, 'track').mockRejectedValue(new Error('SAM unavailable'));
    const redactor = new FfmpegVideoRedactor(segmenter);
    await expect(
      redactor.redact({
        data: new Uint8Array(await readFile(fixture)),
        mimeType: 'video/mp4',
      }),
    ).rejects.toThrow('SAM unavailable');
    await expect(
      redactor.redact({ data: new Uint8Array([1, 2, 3]), mimeType: 'video/mp4' }),
    ).rejects.toThrow();
    expect(await temporaryClips()).toEqual(before);
  });
});

it('reports unavailable when ffmpeg is not on the PATH', async () => {
  vi.stubEnv('PATH', '/does-not-exist');
  try {
    expect(await videoRedactionAvailable()).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
