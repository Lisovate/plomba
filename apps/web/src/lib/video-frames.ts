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

/** Thrown when the browser hands back blank frames instead of the clip's pictures. */
export class BlankFramesError extends Error {
  override name = 'BlankFramesError';
}

/**
 * Resolves once the frame at the current position has been presented, which
 * is when Safari can draw it (before that it draws black). Falls back to a
 * short wait where `requestVideoFrameCallback` isn't available or doesn't fire.
 */
function presented(video: HTMLVideoElement, timeoutMs = 600): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => {
        clearTimeout(timer);
        resolve();
      });
    }
  });
}

/** True when a drawn frame is one flat colour, e.g. the black Safari draws for an unpainted video. */
function isBlank(source: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  probe.width = 16;
  probe.height = 9;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(source, 0, 0, 16, 9);
  const { data } = context.getImageData(0, 0, 16, 9);
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const value = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return max - min < 4;
}

/**
 * Fixed native canvas size and JPEG quality for the same clip and times.
 * Encoders can still differ by browser, so face naming also sends the clip hash and frame numbers.
 */
export async function grabFrames(src: string, times: readonly number[]): Promise<Blob[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Safari only decodes and paints a video that is in the document: keep it there, out of sight.
  Object.assign(video.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '2px',
    height: '2px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.append(video);
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
      await presented(video);
      context.drawImage(video, 0, 0);
      if (isBlank(canvas)) {
        // One more chance: some browsers present the seeked frame late.
        await presented(video, 1500);
        context.drawImage(video, 0, 0);
        if (isBlank(canvas)) throw new BlankFramesError('The browser returned blank video frames');
      }
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
    video.remove();
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
