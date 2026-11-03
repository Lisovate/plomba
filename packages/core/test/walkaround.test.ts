import { describe, expect, it } from 'vitest';
import type { Quad } from '../src/geometry.ts';
import {
  bestFramePerFace,
  faceAtFrame,
  frameScore,
  pickCandidateFrames,
  squareness,
} from '../src/walkaround.ts';

const size = { width: 1280, height: 720 };

const rect = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A side seen at an angle: the far end is shorter than the near end. */
const receding: Quad = [
  { x: 100, y: 100 },
  { x: 1100, y: 250 },
  { x: 1100, y: 470 },
  { x: 100, y: 620 },
];

describe('squareness', () => {
  it('is 1 for a rectangle and lower for a face seen at an angle', () => {
    expect(squareness(rect(100, 100, 1100, 600))).toBeCloseTo(1, 9);
    expect(squareness(receding)).toBeLessThan(0.9);
  });
});

describe('frameScore', () => {
  it('scores a large square-on face by the share of the frame it covers', () => {
    expect(frameScore(rect(140, 160, 1140, 560), size)).toBeCloseTo((1000 * 400) / (1280 * 720), 9);
  });

  it('is 0 when the face is cut off by the frame edge', () => {
    expect(frameScore(rect(0, 160, 1140, 560), size)).toBe(0);
    expect(frameScore(rect(140, 160, 1280, 560), size)).toBe(0);
  });

  it('is 0 when the face is too small to register', () => {
    expect(frameScore(rect(600, 300, 700, 360), size)).toBe(0);
  });

  it('prefers a square-on view to an angled one of the same size', () => {
    expect(frameScore(rect(100, 100, 1100, 620), size)).toBeGreaterThan(frameScore(receding, size));
  });
});

describe('pickCandidateFrames', () => {
  // A clip where the face grows to its largest at frame 20, then shrinks; frames 40–49 are cut off.
  const outlines = Array.from({ length: 60 }, (_, frame) => {
    const half = 300 - Math.abs(frame - 20) * 5;
    return {
      frame,
      corners:
        frame >= 40 && frame < 50 ? rect(0, 100, 900, 600) : rect(640 - half, 200, 640 + half, 520),
    };
  });

  it('takes the best frame first and keeps chosen frames apart', () => {
    const picked = pickCandidateFrames(outlines, size, { minGap: 15 });
    expect(picked.map((c) => c.frame)).toContain(20);
    const frames = picked.map((c) => c.frame);
    for (let i = 1; i < frames.length; i++) {
      expect((frames[i] ?? 0) - (frames[i - 1] ?? 0)).toBeGreaterThanOrEqual(15);
    }
  });

  it('never picks a frame where the face is cut off, and honours the maximum', () => {
    const picked = pickCandidateFrames(outlines, size, { minGap: 1, max: 50 });
    expect(picked.some((c) => c.frame >= 40 && c.frame < 50)).toBe(false);
    expect(pickCandidateFrames(outlines, size, { minGap: 1, max: 3 })).toHaveLength(3);
  });

  it('returns frames in clip order', () => {
    const frames = pickCandidateFrames(outlines, size, { minGap: 5 }).map((c) => c.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });
});

describe('bestFramePerFace', () => {
  it('keeps the highest-scoring square-on candidate of each face', () => {
    const candidates = [
      { frame: 0, score: 0.3 },
      { frame: 15, score: 0.5 },
      { frame: 30, score: 0.9 },
      { frame: 45, score: 0.6 },
    ];
    const best = bestFramePerFace(candidates, [
      { face: 'D', squareOn: true },
      { face: 'D', squareOn: true },
      { face: 'R', squareOn: false },
      { face: null, squareOn: false },
    ]);
    expect(best.get('D')?.frame).toBe(15);
    expect(best.has('R')).toBe(false);
  });
});

describe('faceAtFrame', () => {
  const named = [
    { frame: 10, face: 'D' as const },
    { frame: 40, face: 'R' as const },
  ];

  it('uses the nearest named frame within reach', () => {
    expect(faceAtFrame(named, 12, 10)).toBe('D');
    expect(faceAtFrame(named, 33, 10)).toBe('R');
  });

  it('is null between faces, where the camera turns a corner', () => {
    expect(faceAtFrame(named, 25, 10)).toBeNull();
  });
});
