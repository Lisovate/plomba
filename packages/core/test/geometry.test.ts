import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  DegenerateGeometryError,
  faceToImage,
  imagePointsToFaceRect,
  invertHomography,
  type Point,
  projectFaceRect,
  type Quad,
  quadFromPoints,
  solveHomography,
} from '../src/geometry.ts';
import { DEFAULT_DIMENSIONS } from '../src/size-type.ts';

const close = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('solveHomography', () => {
  it('maps the four source corners onto the destination corners', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const dst: Quad = [
      { x: 10, y: 20 },
      { x: 110, y: 30 },
      { x: 100, y: 140 },
      { x: 5, y: 120 },
    ];
    const h = solveHomography(src, dst);
    src.forEach((p, i) => {
      close(applyHomography(h, p), dst[i] as Point);
    });
  });

  it('round-trips through its inverse', () => {
    const h = solveHomography(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ],
      [
        { x: 50, y: 40 },
        { x: 600, y: 80 },
        { x: 620, y: 420 },
        { x: 30, y: 460 },
      ],
    );
    const p = { x: 1.3, y: 2.2 };
    close(applyHomography(invertHomography(h), applyHomography(h, p)), p);
  });

  it('rejects collinear points', () => {
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(() => solveHomography(line, line)).toThrow(DegenerateGeometryError);
  });
});

describe('quadFromPoints', () => {
  it('finds the corners of a filled, slightly skewed quadrilateral', () => {
    const points: Point[] = [];
    for (let y = 10; y <= 100; y++) {
      const left = 20 + (y - 10) * 0.05;
      const right = 200 - (y - 10) * 0.1;
      for (let x = Math.ceil(left); x <= Math.floor(right); x++) points.push({ x, y });
    }
    const [tl, tr, br, bl] = quadFromPoints(points);
    expect(tl).toEqual({ x: 20, y: 10 });
    expect(tr).toEqual({ x: 200, y: 10 });
    expect(br.y).toBe(100);
    expect(bl.y).toBe(100);
  });
});

describe('face to image', () => {
  const corners: Quad = [
    { x: 100, y: 50 },
    { x: 900, y: 70 },
    { x: 880, y: 400 },
    { x: 120, y: 420 },
  ];

  it('places the face corners on the photo corners (v up, image y down)', () => {
    const h = faceToImage('R', DEFAULT_DIMENSIONS, corners);
    close(applyHomography(h, { x: 0, y: DEFAULT_DIMENSIONS.height }), corners[0]);
    close(applyHomography(h, { x: 0, y: 0 }), corners[3]);
  });

  it('maps a face rectangle into the photo and back', () => {
    const h = faceToImage('R', DEFAULT_DIMENSIONS, corners);
    const rect = { u0: 2, v0: 0.5, u1: 3, v1: 1.5 };
    const outline = projectFaceRect(h, rect);
    const back = imagePointsToFaceRect(invertHomography(h), outline);
    expect(back.u0).toBeCloseTo(rect.u0, 6);
    expect(back.v0).toBeCloseTo(rect.v0, 6);
    expect(back.u1).toBeCloseTo(rect.u1, 6);
    expect(back.v1).toBeCloseTo(rect.v1, 6);
  });
});
