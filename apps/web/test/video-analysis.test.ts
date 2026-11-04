import type { FaceView } from '@plomba/contracts';
import type { Quad } from '@plomba/core';
import { describe, expect, it } from 'vitest';
import { candidateView } from '../src/lib/video-analysis.ts';

const quad: Quad = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 90, y: 60 },
  { x: 10, y: 60 },
];
const view: FaceView = {
  face: 'L',
  squareOn: false,
  corner: null,
  doorEnd: null,
  clear: true,
  confidence: 0.9,
  note: '',
};

describe('candidateView', () => {
  it('draws a named face even at an angle', () => {
    expect(candidateView({ view, split: null })).toEqual({ face: 'L' });
  });

  it('draws both faces of a corner only when tracking provides their outlines', () => {
    const cornerView = { ...view, face: null, corner: { left: 'L', right: 'D' } } as const;
    expect(candidateView({ view: cornerView, split: { left: quad, right: quad } })).toEqual({
      corner: { left: 'L', right: 'D' },
    });
    expect(candidateView({ view: cornerView, split: null })).toBeNull();
  });

  it('does not invent a face for an unnamed frame', () => {
    expect(candidateView({ view: { ...view, face: null }, split: null })).toBeNull();
  });
});
