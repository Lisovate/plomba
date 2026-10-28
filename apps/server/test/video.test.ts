import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import { VideoService, videoType } from '../src/services/video.ts';
import { FakeSegmenter, MemoryCache, rectangleObject } from './fakes.ts';

/** The first bytes of an ISO base media file with the given brand. */
function isoFile(brand: string): Uint8Array {
  return new TextEncoder().encode(`\0\0\0\x18ftyp${brand}\0\0\0\0isommp42`);
}

describe('videoType', () => {
  it('tells MP4 from MOV by the ftyp brand', () => {
    expect(videoType(isoFile('isom'))).toBe('video/mp4');
    expect(videoType(isoFile('qt  '))).toBe('video/quicktime');
  });

  it('rejects WebM, which SAM 3.1 does not read', () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => videoType(webm)).toThrow(ValidationError);
  });
});

describe('VideoService', () => {
  it('turns tracked frames into face corners and caches the result by content', async () => {
    const segmenter = new FakeSegmenter();
    segmenter.tracked = [
      { frame: 0, objects: [rectangleObject(10, 10, 110, 60)] },
      { frame: 1, objects: [] },
      { frame: 2, objects: [rectangleObject(20, 10, 120, 60)] },
    ];
    const service = new VideoService(segmenter, new MemoryCache());

    const first = await service.track(isoFile('isom'));
    expect(first.cached).toBe(false);
    expect(first.frameCount).toBe(3);
    expect(first.frames.map((f) => f.frame)).toEqual([0, 2]);
    expect(first.frames[1]?.corners[0]).toEqual({ x: 20, y: 10.5 });
    expect(segmenter.calls).toEqual(['track:shipping container']);

    const again = await service.track(isoFile('isom'));
    expect(again.cached).toBe(true);
    expect(segmenter.calls).toHaveLength(1);
  });

  it('follows the same container through the clip', async () => {
    const segmenter = new FakeSegmenter();
    const big = (id: string) => ({ ...rectangleObject(0, 0, 200, 100), id });
    const small = (id: string) => ({ ...rectangleObject(300, 0, 340, 20), id });
    // Object "1" is the big one overall; in frame 1 only "2" is visible.
    segmenter.tracked = [
      { frame: 0, objects: [big('1'), small('2')] },
      { frame: 1, objects: [small('2')] },
      { frame: 2, objects: [big('1'), small('2')] },
    ];
    const result = await new VideoService(segmenter, new MemoryCache()).track(isoFile('isom'));
    expect(result.frames.map((f) => f.frame)).toEqual([0, 2]);
  });
});
