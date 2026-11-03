/**
 * Grabs still frames from a clip in the browser, so the server needs no video
 * decoder: the clip is decoded once by SAM 3.1 for tracking, and the few frames
 * worth keeping are cut out here.
 */

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      target.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      target.removeEventListener(event, ok);
      reject(new Error('The browser could not decode this video'));
    };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

/** The frames at the given times (seconds), as JPEG at the clip's own resolution. */
export async function grabFrames(src: string, times: readonly number[]): Promise<Blob[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  try {
    await once(video, 'loadeddata');
    // Safari paints nothing to a canvas until the video has played once.
    await video.play().catch(() => undefined);
    video.pause();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    const frames: Blob[] = [];
    for (const time of times) {
      const seeked = once(video, 'seeked');
      video.currentTime = Math.min(time, video.duration);
      await seeked;
      context.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      );
      if (!blob) throw new Error('Could not encode a frame');
      frames.push(blob);
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** The time in seconds of the middle of a frame, given the clip's frame rate. */
export function frameTime(frame: number, fps: number): number {
  return (frame + 0.5) / fps;
}

/** A clip's pixel size and duration, read from its metadata. */
export async function probeVideo(
  src: string,
): Promise<{ width: number; height: number; duration: number }> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = src;
  try {
    await once(video, 'loadedmetadata');
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
