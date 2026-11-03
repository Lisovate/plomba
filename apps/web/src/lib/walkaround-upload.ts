import type { Face, Photo } from '@plomba/contracts';
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

/** The three calls adding a frame takes; the app's API client provides them. */
export interface FrameUploadApi {
  uploadPhoto(handoverId: string, face: Face, image: Blob): Promise<Photo>;
  updateCorners(handoverId: string, photoId: string, corners: Quad): Promise<Photo>;
  proposeDamage(handoverId: string, photoId: string): Promise<unknown>;
}

/** How far each frame got. Kept by the caller between attempts. */
export type FrameSteps = Map<string, { photo: Photo; outlined: boolean; searched: boolean }>;

/**
 * Adds the chosen frames to a handover: upload, set a corner view's outline,
 * then ask for damage proposals. Each step is recorded in `steps` as soon as
 * it succeeds, so calling again after a failure resumes at the step that
 * failed: a photo is never uploaded twice, nor its damage searched twice.
 */
export async function addFrames(
  handoverId: string,
  frames: readonly FrameUpload[],
  options: {
    readonly api: FrameUploadApi;
    readonly steps: FrameSteps;
    readonly findDamage: boolean;
    readonly onProgress?: (stage: 'upload' | 'damage', index: number, frame: FrameUpload) => void;
  },
): Promise<void> {
  const { api, steps, findDamage, onProgress } = options;
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
}
