import { describe, expect, it } from 'vitest';
import type { Quad } from '../src/geometry.ts';
import {
  bestFramePerFace,
  chooseWalkaroundPhotos,
  frameScore,
  harmonizeSides,
  isCornerPair,
  pickCandidateFrames,
  sideFromDoorEnd,
  splitCornerView,
  squareness,
  usableSplit,
  viewAtFrame,
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
    // Seen only at an angle, the right side is still chosen rather than left out.
    expect(best.get('R')?.frame).toBe(30);
  });

  it('prefers a square-on frame to a larger one seen at an angle', () => {
    const best = bestFramePerFace(
      [
        { frame: 0, score: 0.7 },
        { frame: 15, score: 0.4 },
      ],
      [
        { face: 'L', squareOn: false },
        { face: 'L', squareOn: true },
      ],
    );
    expect(best.get('L')?.frame).toBe(15);
  });

  it('prefers a clear frame to a larger one with a hand in front of the face', () => {
    const best = bestFramePerFace(
      [
        { frame: 0, score: 0.6 },
        { frame: 15, score: 0.4 },
      ],
      [
        { face: 'L', squareOn: true, clear: false },
        { face: 'L', squareOn: true, clear: true },
      ],
    );
    expect(best.get('L')?.frame).toBe(15);
  });
});

describe('viewAtFrame', () => {
  const named = [
    { frame: 10, view: 'D' },
    { frame: 40, view: 'R' },
  ];

  it('uses the nearest named frame within reach', () => {
    expect(viewAtFrame(named, 12, 10)).toBe('D');
    expect(viewAtFrame(named, 33, 10)).toBe('R');
  });

  it('is null between faces, where the camera turns a corner', () => {
    expect(viewAtFrame(named, 25, 10)).toBeNull();
  });
});

describe('splitCornerView', () => {
  // A container seen corner-on from eye level: the near edge at x = 400 is
  // taller than the outer edges at x = 100 and x = 1100.
  const tl = { x: 100, y: 200 };
  const tn = { x: 400, y: 160 };
  const tr = { x: 1100, y: 230 };
  const br = { x: 1100, y: 470 };
  const bn = { x: 400, y: 560 };
  const bl = { x: 100, y: 500 };
  const hexagon = [tl, tn, tr, br, bn, bl];

  it('splits the outline at the near vertical edge', () => {
    const split = splitCornerView(hexagon, [tl, tr, br, bl]);
    expect(split?.left).toEqual([tl, tn, bn, bl]);
    expect(split?.right).toEqual([tn, tr, br, bn]);
  });

  it('leaves a face seen square-on whole', () => {
    expect(splitCornerView([tl, tr, br, bl], [tl, tr, br, bl])).toBeNull();
  });

  it('refuses a view from above, where the top of the outline is the roof', () => {
    // The roof's far corner peaks at x = 900, nowhere near the foot of the near edge.
    const roofPeak = { x: 900, y: 120 };
    const fromAbove = [tl, roofPeak, tr, br, bn, bl];
    expect(splitCornerView(fromAbove, [tl, tr, br, bl])).toBeNull();
  });

  it('refuses a split that leaves a sliver of a face', () => {
    const nearEnd = [tl, { x: 130, y: 160 }, tr, br, { x: 130, y: 560 }, bl];
    expect(splitCornerView(nearEnd, [tl, tr, br, bl])).toBeNull();
  });
});

describe('isCornerPair', () => {
  it('accepts the faces either side of each vertical corner, left then right', () => {
    expect(isCornerPair('D', 'R')).toBe(true);
    expect(isCornerPair('R', 'F')).toBe(true);
    expect(isCornerPair('F', 'L')).toBe(true);
    expect(isCornerPair('L', 'D')).toBe(true);
  });

  it('refuses the same pair the wrong way round, opposite faces and the roof', () => {
    expect(isCornerPair('R', 'D')).toBe(false);
    expect(isCornerPair('D', 'F')).toBe(false);
    expect(isCornerPair('T', 'D')).toBe(false);
  });
});

describe('chooseWalkaroundPhotos', () => {
  const quad = (x0: number, x1: number): Quad => rect(x0, 100, x1, 500);
  const split = { left: quad(100, 300), right: quad(300, 1100) };

  it('takes a corner view for the faces no square-on frame shows', () => {
    const choices = chooseWalkaroundPhotos([
      { frame: 0, score: 0.5, view: { face: 'R', squareOn: true }, split: null },
      {
        frame: 20,
        score: 0.4,
        view: { face: null, squareOn: false, corner: { left: 'D', right: 'R' } },
        split,
      },
    ]);
    expect(choices).toEqual([
      { index: 0, part: 'whole', face: 'R' },
      { index: 1, part: 'left', face: 'D' },
    ]);
  });

  it('prefers the corner view where the face is largest', () => {
    const wider = { left: quad(100, 700), right: quad(700, 1100) };
    const corner = { face: null, squareOn: false, corner: { left: 'D', right: 'R' } } as const;
    const choices = chooseWalkaroundPhotos([
      { frame: 0, score: 0.4, view: corner, split },
      { frame: 20, score: 0.4, view: corner, split: wider },
    ]);
    expect(choices).toContainEqual({ index: 1, part: 'left', face: 'D' });
    expect(choices).toContainEqual({ index: 0, part: 'right', face: 'R' });
  });

  it('uses a corner view only split, even when the model also saw one face square-on', () => {
    const choices = chooseWalkaroundPhotos([
      {
        frame: 0,
        score: 0.5,
        view: { face: 'D', squareOn: true, corner: { left: 'D', right: 'R' } },
        split,
      },
    ]);
    expect(choices).toEqual([
      { index: 0, part: 'left', face: 'D' },
      { index: 0, part: 'right', face: 'R' },
    ]);
  });
});

describe('harmonizeSides', () => {
  const tracked = (frames: number, corners: number[] = []) =>
    Array.from({ length: frames }, (_, frame) => ({
      frame,
      split: corners.includes(frame) ? {} : null,
    }));
  const side = (face: 'L' | 'R', confidence = 0.9) => ({
    face,
    squareOn: true,
    confidence,
    doorEnd: null as 'left' | 'right' | null,
  });

  it('names one continuous view of a side the same, by weighted majority', () => {
    const views = harmonizeSides(
      [
        { frame: 0, view: side('R', 0.6) },
        { frame: 15, view: side('L') },
        { frame: 30, view: side('L') },
      ],
      tracked(40),
    ).views;
    expect(views.map((v) => v.face)).toEqual(['L', 'L', 'L']);
  });

  it('keeps sides apart where the camera turns a corner in between', () => {
    const views = harmonizeSides(
      [
        { frame: 0, view: side('L') },
        { frame: 30, view: side('R') },
      ],
      tracked(40, [15]),
    ).views;
    expect(views.map((v) => v.face)).toEqual(['L', 'R']);
  });

  it('keeps sides apart where the container is lost in between, and leaves ties alone', () => {
    const lost = tracked(40).filter((t) => t.frame !== 20);
    expect(
      harmonizeSides(
        [
          { frame: 0, view: side('L') },
          { frame: 30, view: side('R') },
        ],
        lost,
      ).views.map((v) => v.face),
    ).toEqual(['L', 'R']);
    expect(
      harmonizeSides(
        [
          { frame: 0, view: side('L') },
          { frame: 30, view: side('R') },
        ],
        tracked(40),
      ).views.map((v) => v.face),
    ).toEqual(['L', 'R']);
  });

  it('lets frames that show the door end decide, whatever the model named the side', () => {
    // Doors at the right of the image: the left side, though the model said right.
    const { views, guessed } = harmonizeSides(
      [
        { frame: 0, view: { ...side('R'), doorEnd: 'right' as const } },
        { frame: 15, view: side('R') },
        { frame: 30, view: side('R') },
      ],
      tracked(40),
    );
    expect(views.map((v) => v.face)).toEqual(['L', 'L', 'L']);
    expect(guessed.size).toBe(0);
  });

  it('marks a side as guessed when no frame showed the door end', () => {
    const { guessed } = harmonizeSides(
      [
        { frame: 0, view: side('L') },
        { frame: 15, view: side('L') },
      ],
      tracked(20),
    );
    expect([...guessed]).toEqual([0, 1]);
  });
});

describe('sideFromDoorEnd', () => {
  it('follows the convention: doors on the right of the image mean the left side', () => {
    expect(sideFromDoorEnd('right')).toBe('L');
    expect(sideFromDoorEnd('left')).toBe('R');
  });
});

describe('usableSplit', () => {
  const size = { width: 1280, height: 720 };
  const split = {
    left: rect(100, 100, 400, 600),
    right: rect(400, 100, 1100, 600),
  };

  it('keeps a split whose near edge is in the frame', () => {
    expect(usableSplit(split, size)).toBe(split);
  });

  it('drops a split whose near edge the frame cuts off', () => {
    const cut = { ...split, left: rect(100, 100, 400, 720) };
    expect(usableSplit(cut, size)).toBeNull();
    expect(usableSplit(null, size)).toBeNull();
  });
});

describe('chooseWalkaroundPhotos with someone in front of a corner', () => {
  it('still uses the corner, at half weight', () => {
    const split = { left: rect(100, 100, 300, 500), right: rect(300, 100, 1100, 500) };
    const choices = chooseWalkaroundPhotos([
      {
        frame: 0,
        score: 0.5,
        view: { face: null, squareOn: false, clear: false, corner: { left: 'D', right: 'R' } },
        split,
      },
    ]);
    expect(choices.map((c) => c.face).sort()).toEqual(['D', 'R']);
  });
});
