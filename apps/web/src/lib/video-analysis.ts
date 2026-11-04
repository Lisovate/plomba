import type { FaceView, VideoTracking } from '@plomba/contracts';
import {
  type CornerSplit,
  chooseWalkaroundPhotos,
  type Face,
  type FrameCandidate,
  harmonizeSides,
  type PhotoChoice,
  pickCandidateFrames,
  usableSplit,
} from '@plomba/core';
import { api } from '../api/client.ts';
import { frameTime, grabFrames, probeVideo } from './video-frames.ts';

export type FrameView =
  | { readonly face: Face }
  | { readonly corner: { readonly left: Face; readonly right: Face } };

export interface VideoCandidate extends FrameCandidate {
  readonly blob: Blob;
  readonly view: FaceView;
  readonly split: CornerSplit | null;
  /** Left or right was inferred without the doors in view. */
  readonly guessedSide: boolean;
}

export interface VideoAnalysis {
  readonly tracking: VideoTracking;
  readonly fps: number;
  readonly size: { readonly width: number; readonly height: number };
  readonly candidates: readonly VideoCandidate[];
  readonly choices: readonly PhotoChoice[];
}

export type VideoAnalysisStep = 'tracking' | 'choosing' | 'naming';

/** Shared by walk-arounds and the sample player; this never creates a handover. */
export async function analyseVideo(
  chosen: { file: File; url: string },
  onStep: (step: VideoAnalysisStep) => void,
): Promise<VideoAnalysis> {
  onStep('tracking');
  const tracking = await api.trackVideo(chosen.file);
  const { width, height, duration } = await probeVideo(chosen.url);
  const fps = tracking.frameCount / (duration || 1);
  const size = { width, height };
  onStep('choosing');
  const picked = pickCandidateFrames(tracking.frames, size, {
    minGap: Math.max(1, Math.round(fps)),
    max: 12,
  });
  if (picked.length === 0) return { tracking, fps, size, candidates: [], choices: [] };
  const blobs = await grabFrames(
    chosen.url,
    picked.map((c) => frameTime(c.frame, fps)),
  );
  onStep('naming');
  const { views: named } = await api.videoFaces(blobs);
  const unnamed: FaceView = {
    face: null,
    squareOn: false,
    corner: null,
    doorEnd: null,
    clear: false,
    confidence: 0,
    note: '',
  };
  // One continuous view of a side is one side, whatever single frames say.
  const { views, guessed } = harmonizeSides(
    picked.map((c, i) => ({ frame: c.frame, view: named[i] ?? unnamed })),
    tracking.frames,
  );
  const splits = new Map(tracking.frames.map((f) => [f.frame, usableSplit(f.split, size)]));
  const candidates = picked.map((c, i) => ({
    ...c,
    blob: blobs[i] as Blob,
    view: views[i] ?? unnamed,
    split: splits.get(c.frame) ?? null,
    guessedSide: guessed.has(i),
  }));
  return { tracking, fps, size, candidates, choices: chooseWalkaroundPhotos(candidates) };
}

/** An angled face can guide the overlay even when it isn't suitable as a face photo. */
export function candidateView(candidate: Pick<VideoCandidate, 'view' | 'split'>): FrameView | null {
  if (candidate.split && candidate.view.corner) return { corner: candidate.view.corner };
  return candidate.view.face ? { face: candidate.view.face } : null;
}
