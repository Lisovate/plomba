import type { Face, FaceView, Photo, VideoViews } from '@plomba/contracts';
import type { Quad } from '@plomba/core';

/** One frame the checker chose from a walk-around, to become a photo of `face`. */
export interface FrameUpload {
  /** Identifies the choice across retries (the frame and, for a corner view, which part). */
  readonly key: string;
  readonly face: Face;
  /** The image to upload, prepared for it (downscaled, metadata dropped). */
  readonly image: () => Promise<Blob>;
  /**
   * The face's outline from a corner view's split, in the uploaded photo's
   * pixels; null when the photo shows the face whole and the server finds it.
   */
  readonly outline: (photo: Photo) => Quad | null;
}

/** The calls adding frames and their clip takes; the app's API client provides them. */
export interface FrameUploadApi {
  uploadPhoto(handoverId: string, face: Face, image: Blob): Promise<Photo>;
  updateCorners(handoverId: string, photoId: string, corners: Quad): Promise<Photo>;
  proposeDamage(handoverId: string, photoId: string): Promise<unknown>;
  uploadVideo(handoverId: string, video: Blob, views: VideoViews): Promise<unknown>;
}

/** How far each frame got. Kept by the caller between attempts. */
export type FrameSteps = Map<string, { photo: Photo; outlined: boolean; searched: boolean }>;

/** Kept separately from the frame steps so retries can resume the final clip upload. */
export interface VideoStep {
  uploaded: boolean;
}

/** Keep only selected frames, with any face corrections made by the checker. */
export function chosenVideoViews(
  candidates: readonly { readonly frame: number; readonly view: FaceView }[],
  choices: readonly {
    readonly index: number;
    readonly part: 'whole' | 'left' | 'right';
    readonly face: Face;
  }[],
): VideoViews {
  return candidates.flatMap((candidate, index) => {
    const kept = choices.filter((choice) => choice.index === index);
    if (kept.length === 0) return [];
    const whole = kept.find((choice) => choice.part === 'whole');
    const corner =
      !whole && candidate.view.corner
        ? {
            left: kept.find((choice) => choice.part === 'left')?.face ?? candidate.view.corner.left,
            right:
              kept.find((choice) => choice.part === 'right')?.face ?? candidate.view.corner.right,
          }
        : null;
    return [
      {
        frame: candidate.frame,
        view: {
          ...candidate.view,
          face: whole?.face ?? (corner ? null : candidate.view.face),
          corner,
        },
      },
    ];
  });
}

/**
 * Adds the chosen frames to a handover: upload, set a corner view's outline,
 * then ask for damage proposals. Each step is recorded in `steps` as soon as
 * it succeeds, so calling again after a failure resumes at the step that
 * failed: a photo is never uploaded twice, nor its damage searched twice.
 * The optional clip is uploaded last, with its own progress kept across retries.
 */
export async function addFrames(
  handoverId: string,
  frames: readonly FrameUpload[],
  options: {
    readonly api: FrameUploadApi;
    readonly steps: FrameSteps;
    readonly findDamage: boolean;
    readonly video?:
      | { readonly data: Blob; readonly views: VideoViews; readonly step: VideoStep }
      | undefined;
    readonly onVideoProgress?: () => void;
    readonly onProgress?: (stage: 'upload' | 'damage', index: number, frame: FrameUpload) => void;
  },
): Promise<void> {
  const { api, steps, findDamage, onProgress, video } = options;
  for (const [index, frame] of frames.entries()) {
    let step = steps.get(frame.key);
    if (!step) {
      onProgress?.('upload', index, frame);
      const photo = await api.uploadPhoto(handoverId, frame.face, await frame.image());
      step = { photo, outlined: false, searched: false };
      steps.set(frame.key, step);
    }
    if (!step.outlined) {
      const outline = frame.outline(step.photo);
      if (outline) step.photo = await api.updateCorners(handoverId, step.photo.id, outline);
      step.outlined = true;
    }
    if (!step.searched) {
      if (findDamage && step.photo.corners) {
        onProgress?.('damage', index, frame);
        await api.proposeDamage(handoverId, step.photo.id);
      }
      step.searched = true;
    }
  }
  if (video && !video.step.uploaded) {
    options.onVideoProgress?.();
    await api.uploadVideo(handoverId, video.data, video.views);
    video.step.uploaded = true;
  }
}
