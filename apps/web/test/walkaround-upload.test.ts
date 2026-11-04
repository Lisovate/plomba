import type { Face, FaceView, Photo, VideoViews } from '@plomba/contracts';
import type { Quad } from '@plomba/core';
import { describe, expect, it } from 'vitest';
import {
  addFrames,
  chosenVideoViews,
  type FrameSteps,
  type FrameUpload,
  type FrameUploadApi,
} from '../src/lib/walkaround-upload.ts';

const HANDOVER = '00000000-0000-4000-8000-000000000001';
const SQUARE: NonNullable<Photo['corners']> = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 90, y: 60 },
  { x: 10, y: 60 },
];

/** An API that records every call and can be told to fail a call once. */
function fakeApi(failOnce: Partial<Record<keyof FrameUploadApi, number>> = {}) {
  const calls: string[] = [];
  const videos: { handoverId: string; video: Blob; views: VideoViews }[] = [];
  let photos = 0;
  const failures = { ...failOnce };
  const maybeFail = (name: keyof FrameUploadApi) => {
    const n = failures[name];
    if (n === undefined) return;
    if (n === 0) {
      delete failures[name];
      throw new Error(`${name} failed`);
    }
    failures[name] = n - 1;
  };
  const photo = (face: Face, corners: Photo['corners']): Photo => ({
    id: `00000000-0000-4000-8000-00000000010${photos}`,
    handoverId: HANDOVER,
    face,
    url: '/media/x',
    sha256: 'a'.repeat(64),
    width: 100,
    height: 75,
    corners,
    cornersSource: corners ? 'detected' : null,
    redactedRegions: 0,
    capturedAt: '2026-11-03T14:05:11.000Z',
  });
  const api: FrameUploadApi = {
    async uploadPhoto(_handoverId, face) {
      calls.push(`upload ${face}`);
      maybeFail('uploadPhoto');
      photos += 1;
      return photo(face, SQUARE);
    },
    async updateCorners(_handoverId, photoId, corners) {
      calls.push(`corners ${photoId.slice(-1)}`);
      maybeFail('updateCorners');
      return {
        ...photo('R', [...corners] as Photo['corners']),
        id: photoId,
        cornersSource: 'adjusted',
      };
    },
    async uploadVideo(handoverId, video, views) {
      calls.push('video');
      maybeFail('uploadVideo');
      videos.push({ handoverId, video, views });
    },
    async proposeDamage(_handoverId, photoId) {
      calls.push(`damage ${photoId.slice(-1)}`);
      maybeFail('proposeDamage');
      return [];
    },
  };
  return { api, calls, videos };
}

const frame = (key: string, face: Face, outline: Quad | null = null): FrameUpload => ({
  key,
  face,
  image: async () => new Blob(['jpeg']),
  outline: () => outline,
});

describe('addFrames', () => {
  it('uploads the clip last with the chosen views and never repeats a completed upload', async () => {
    const { api, calls, videos } = fakeApi();
    const steps: FrameSteps = new Map();
    const frames = [frame('0:whole', 'D')];
    const video = {
      data: new Blob(['video']),
      views: [{ frame: 12, view: doorView }],
      step: { uploaded: false },
    };
    await addFrames(HANDOVER, frames, { api, steps, findDamage: true, video });
    await addFrames(HANDOVER, frames, { api, steps, findDamage: true, video });
    expect(calls).toEqual(['upload D', 'damage 1', 'video']);
    expect(videos).toEqual([{ handoverId: HANDOVER, video: video.data, views: video.views }]);
    expect(video.step.uploaded).toBe(true);
  });

  it('resumes a failed clip upload without repeating photos, outlines or damage searches', async () => {
    const { api, calls } = fakeApi({ uploadVideo: 0 });
    const steps: FrameSteps = new Map();
    const frames = [frame('3:right', 'R', SQUARE)];
    const video = { data: new Blob(['video']), views: [], step: { uploaded: false } };
    await expect(
      addFrames(HANDOVER, frames, { api, steps, findDamage: true, video }),
    ).rejects.toThrow('uploadVideo failed');
    expect(video.step.uploaded).toBe(false);
    await addFrames(HANDOVER, frames, { api, steps, findDamage: true, video });
    expect(calls).toEqual(['upload R', 'corners 1', 'damage 1', 'video', 'video']);
    expect(video.step.uploaded).toBe(true);
  });

  it('waits for all photo steps to succeed before uploading the clip', async () => {
    const { api, calls } = fakeApi({ proposeDamage: 0 });
    const steps: FrameSteps = new Map();
    const frames = [frame('0:whole', 'D')];
    const video = { data: new Blob(['video']), views: [], step: { uploaded: false } };
    await expect(
      addFrames(HANDOVER, frames, { api, steps, findDamage: true, video }),
    ).rejects.toThrow();
    expect(calls).toEqual(['upload D', 'damage 1']);
    expect(video.step.uploaded).toBe(false);
    await addFrames(HANDOVER, frames, { api, steps, findDamage: true, video });
    expect(calls).toEqual(['upload D', 'damage 1', 'damage 1', 'video']);
  });

  it('uploads each frame, sets a corner part outline, and asks for damage', async () => {
    const { api, calls } = fakeApi();
    await addFrames(HANDOVER, [frame('0:whole', 'D'), frame('3:right', 'R', SQUARE)], {
      api,
      steps: new Map(),
      findDamage: true,
    });
    expect(calls).toEqual(['upload D', 'damage 1', 'upload R', 'corners 2', 'damage 2']);
  });

  it('resumes after a failed damage search without uploading the photo again', async () => {
    const { api, calls } = fakeApi({ proposeDamage: 0 });
    const steps: FrameSteps = new Map();
    const frames = [frame('0:whole', 'D'), frame('3:right', 'R', SQUARE)];

    await expect(addFrames(HANDOVER, frames, { api, steps, findDamage: true })).rejects.toThrow(
      'proposeDamage failed',
    );
    await addFrames(HANDOVER, frames, { api, steps, findDamage: true });

    expect(calls).toEqual([
      'upload D',
      'damage 1', // failed
      'damage 1', // the retry starts here
      'upload R',
      'corners 2',
      'damage 2',
    ]);
  });

  it('resumes after a failed outline at the outline, not the upload', async () => {
    const { api, calls } = fakeApi({ updateCorners: 0 });
    const steps: FrameSteps = new Map();
    const frames = [frame('3:left', 'L', SQUARE)];

    await expect(addFrames(HANDOVER, frames, { api, steps, findDamage: false })).rejects.toThrow();
    await addFrames(HANDOVER, frames, { api, steps, findDamage: false });

    expect(calls).toEqual(['upload L', 'corners 1', 'corners 1']);
    expect(steps.get('3:left')?.photo.cornersSource).toBe('adjusted');
  });

  it('does nothing for frames already added', async () => {
    const { api, calls } = fakeApi();
    const steps: FrameSteps = new Map();
    const frames = [frame('0:whole', 'D')];
    await addFrames(HANDOVER, frames, { api, steps, findDamage: true });
    await addFrames(HANDOVER, frames, { api, steps, findDamage: true });
    expect(calls).toEqual(['upload D', 'damage 1']);
  });
});

const doorView: FaceView = {
  face: 'D',
  squareOn: true,
  clear: true,
  corner: null,
  doorEnd: null,
  confidence: 0.9,
  note: 'doors',
};

describe('chosenVideoViews', () => {
  it('keeps selected frames in clip order, applies corrections and combines the parts of a corner', () => {
    const candidates = [
      { frame: 0, view: doorView },
      { frame: 12, view: doorView },
      {
        frame: 24,
        view: {
          ...doorView,
          face: null,
          squareOn: false,
          corner: { left: 'D' as const, right: 'R' as const },
        },
      },
    ];
    const views = chosenVideoViews(candidates, [
      { index: 2, part: 'right', face: 'F' },
      { index: 0, part: 'whole', face: 'L' },
      { index: 2, part: 'left', face: 'R' },
    ]);
    expect(views).toEqual([
      { frame: 0, view: { ...doorView, face: 'L' } },
      { frame: 24, view: { ...candidates[2]?.view, corner: { left: 'R', right: 'F' } } },
    ]);
  });

  it('keeps the other named face when only one part of a corner becomes a photo', () => {
    const view = {
      ...doorView,
      face: null,
      squareOn: false,
      corner: { left: 'D' as const, right: 'R' as const },
    };
    expect(
      chosenVideoViews([{ frame: 24, view }], [{ index: 0, part: 'right', face: 'R' }]),
    ).toEqual([{ frame: 24, view }]);
  });
});
