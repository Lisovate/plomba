import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import { VideoService, videoType } from '../src/services/video.ts';
import { FakeFaceViewClassifier, FakeSegmenter, MemoryCache, rectangleObject } from './fakes.ts';

function videoService(segmenter = new FakeSegmenter(), classifier = new FakeFaceViewClassifier()) {
  return new VideoService({
    segmenter,
    classifier,
    cache: new MemoryCache(),
    facesCache: new MemoryCache(),
  });
}

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#557' } })
    .jpeg()
    .toBuffer();

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
    const service = videoService(segmenter);

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
    const result = await videoService(segmenter).track(isoFile('isom'));
    expect(result.frames.map((f) => f.frame)).toEqual([0, 2]);
  });

  it('names the face in every frame, downscaled, in one call', async () => {
    const classifier = new FakeFaceViewClassifier([
      {
        face: 'D',
        squareOn: true,
        corner: null,
        doorEnd: null,
        clear: true,
        confidence: 0.9,
        note: 'doors',
      },
      {
        face: 'R',
        squareOn: true,
        corner: null,
        doorEnd: null,
        clear: true,
        confidence: 0.8,
        note: 'side, doors on the left',
      },
    ]);
    const service = videoService(undefined, classifier);
    const frames = await Promise.all([jpeg(1920, 1080), jpeg(1920, 1080)]);
    const { views } = await service.faces(frames.map((f) => new Uint8Array(f)));
    expect(views.map((v) => v.face)).toEqual(['D', 'R']);
    expect(classifier.calls).toEqual([2]);
    const { width } = await sharp(classifier.frames[0]?.data).metadata();
    expect(width).toBe(1024);
  });

  it('drops a corner whose faces cannot meet', async () => {
    const corner = (left: 'D' | 'R' | 'F', right: 'D' | 'R' | 'F') => ({
      face: null,
      squareOn: false,
      corner: { left, right },
      doorEnd: null,
      clear: true,
      confidence: 0.8,
      note: 'corner',
    });
    const classifier = new FakeFaceViewClassifier([
      corner('D', 'R'),
      corner('R', 'D'),
      corner('D', 'F'),
    ]);
    const frames = await Promise.all([jpeg(800, 450), jpeg(800, 450), jpeg(800, 450)]);
    const { views } = await videoService(undefined, classifier).faces(
      frames.map((f) => new Uint8Array(f)),
    );
    expect(views.map((v) => v.corner)).toEqual([{ left: 'D', right: 'R' }, null, null]);
  });

  it('caches normalized frame bytes, with misses for different content, count or order', async () => {
    const classifier = new FakeFaceViewClassifier();
    const service = videoService(undefined, classifier);
    const image = sharp({ create: { width: 80, height: 45, channels: 3, background: '#557' } });
    const plain = await image.clone().png().toBuffer();
    const tagged = await image.clone().withMetadata().png().toBuffer();
    const other = await jpeg(64, 36);
    expect(plain).not.toEqual(tagged);

    const first = await service.faces([plain, other]);
    expect(await service.faces([tagged, other])).toEqual(first);
    expect(classifier.calls).toEqual([2]);
    await service.faces([other, plain]);
    await service.faces([plain]);
    await service.faces([plain, await jpeg(32, 18)]);
    expect(classifier.calls).toEqual([2, 2, 1, 2]);
  });

  it('reuses names across browser encodings, but separates clips and selected frames', async () => {
    const classifier = new FakeFaceViewClassifier();
    const segmenter = new FakeSegmenter();
    segmenter.tracked = [{ frame: 19, objects: [] }];
    const service = videoService(segmenter, classifier);
    const clip = isoFile('isom');
    const otherClip = isoFile('mp42');
    await service.track(clip);
    await service.track(otherClip);
    const sha256 = createHash('sha256').update(clip).digest('hex');
    const frames = [await jpeg(80, 45), await jpeg(64, 36)];
    const source = { sha256, frames: [1, 10] };

    const first = await service.faces(frames, source);
    expect(await service.faces([...frames].reverse(), source)).toEqual(first);
    expect(classifier.calls).toEqual([2]);
    await service.faces(frames, { ...source, frames: [2, 10] });
    await service.faces(frames, {
      ...source,
      sha256: createHash('sha256').update(otherClip).digest('hex'),
    });
    expect(classifier.calls).toEqual([2, 2, 2]);
  });

  it.each([
    { sha256: 'bad', frames: [1, 10] },
    { sha256: undefined, frames: [1, 10] },
    { frames: [1] },
    { frames: [10, 1] },
    { frames: [1, 1] },
    { frames: [-1, 10] },
    { frames: [1.5, 10] },
    { frames: [1, 20] },
    { sha256: '0'.repeat(64), frames: [1, 10] },
  ])('rejects an invalid frame source: %j', async (source) => {
    const classifier = new FakeFaceViewClassifier();
    const segmenter = new FakeSegmenter();
    segmenter.tracked = [{ frame: 19, objects: [] }];
    const service = videoService(segmenter, classifier);
    const clip = isoFile('isom');
    await service.track(clip);
    await expect(
      service.faces([await jpeg(80, 45), await jpeg(80, 45)], {
        sha256: createHash('sha256').update(clip).digest('hex'),
        ...source,
      }),
    ).rejects.toThrow(ValidationError);
    expect(classifier.calls).toEqual([]);
  });

  it('refuses no frames or more than one call can look at', async () => {
    const service = videoService();
    await expect(service.faces([])).rejects.toThrow(ValidationError);
    const many = Array.from({ length: 17 }, () => new Uint8Array(1));
    await expect(service.faces(many)).rejects.toThrow(ValidationError);
  });
});
