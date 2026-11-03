import type { HandoverDetail, VideoTracking } from '@plomba/contracts';
import {
  applyHomography,
  type Face,
  faceCells,
  faceToImage,
  type Point,
  projectFaceRect,
  type Quad,
} from '@plomba/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { markShapeInImage } from './face-overlay.tsx';

const points = (shape: readonly Point[]) => shape.map((p) => `${p.x},${p.y}`).join(' ');

/** A tracked frame is used for up to this many frames after it, if later ones are missing. */
const MAX_GAP = 3;

/** The tracked corners for a frame: the latest tracked frame at or before it, if recent. */
function cornersAt(tracking: VideoTracking, frame: number): Quad | null {
  const { frames } = tracking;
  let low = 0;
  let high = frames.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((frames[mid]?.frame ?? 0) <= frame) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const hit = frames[found];
  return hit && frame - hit.frame <= MAX_GAP ? hit.corners : null;
}

interface VideoArProps {
  readonly src: string;
  readonly tracking: VideoTracking | undefined;
  readonly detail: HandoverDetail;
  /** The face in view at a frame, or `null` while the camera turns a corner. */
  readonly faceAt: (frame: number) => Face | null;
  /** Called with the video element, e.g. to capture the current frame. */
  readonly onVideo?: (video: HTMLVideoElement | null) => void;
}

/**
 * Plays a recorded clip with the container's coordinates drawn on it, frame
 * by frame from SAM 3.1's tracking: the CEDEX sections of the face in view,
 * the previous handover's damage (dashed) and this handover's damage. While
 * the camera turns a corner only the container's outline is drawn.
 */
export function VideoAr({ src, tracking, detail, faceAt, onVideo }: VideoArProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState(0);
  const { dimensions } = detail.container;

  useEffect(() => onVideo?.(videoRef.current), [onVideo]);

  // Follow the frame on screen: per presented frame where the browser supports it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !tracking) return;
    let handle = 0;
    let stopped = false;
    const fps = () => tracking.frameCount / (video.duration || 1);
    const update = (mediaTime: number) => setFrame(Math.round(mediaTime * fps()));
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = (_now: number, metadata: { mediaTime: number }) => {
        if (stopped) return;
        update(metadata.mediaTime);
        handle = video.requestVideoFrameCallback(onFrame);
      };
      handle = video.requestVideoFrameCallback(onFrame);
      const onSeek = () => update(video.currentTime);
      video.addEventListener('seeked', onSeek);
      return () => {
        stopped = true;
        video.cancelVideoFrameCallback(handle);
        video.removeEventListener('seeked', onSeek);
      };
    }
    const tick = () => {
      if (stopped) return;
      update(video.currentTime);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(handle);
    };
  }, [tracking]);

  const corners = tracking ? cornersAt(tracking, frame) : null;
  const face = faceAt(frame);
  const h = useMemo(() => {
    if (!corners || !face) return null;
    try {
      return faceToImage(face, dimensions, corners);
    } catch {
      return null;
    }
  }, [corners, face, dimensions]);

  const previous = detail.previousMarks.filter((m) => m.face === face);
  const current = detail.marks.filter((m) => m.face === face && m.source !== 'rejected');
  const px = (size?.width ?? 854) / 600;

  return (
    <div className="overlay-frame video-ar">
      <video
        ref={videoRef}
        src={src}
        controls
        muted
        playsInline
        loop
        onLoadedMetadata={(e) =>
          setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })
        }
      />
      {size && tracking && (
        <svg
          className="overlay passive"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {corners && !h && (
            <polygon points={points(corners)} className="face-outline faint" strokeWidth={2 * px} />
          )}
          {h && corners && face && (
            <>
              {faceCells(face, dimensions).map((cell) => (
                <polygon
                  key={cell.code}
                  points={points(projectFaceRect(h, cell.rect))}
                  className="grid-cell"
                  strokeWidth={1 * px}
                />
              ))}
              <polygon points={points(corners)} className="face-outline" strokeWidth={2 * px} />
              {[
                ...previous.map((m) => ({ m, ghost: true })),
                ...current.map((m) => ({ m, ghost: false })),
              ].map(({ m, ghost }) => {
                const anchor = applyHomography(h, { x: m.rect.u0, y: m.rect.v1 });
                return (
                  <g key={m.id} className={ghost ? 'mark-ghost' : 'mark'}>
                    <polygon points={points(markShapeInImage(h, m))} strokeWidth={2 * px} />
                    <text x={anchor.x} y={anchor.y - 3 * px} fontSize={11 * px}>
                      {[m.locationCode, m.damageCode].filter(Boolean).join(' ')}
                    </text>
                  </g>
                );
              })}
            </>
          )}
        </svg>
      )}
      <p className="live-status">
        {tracking
          ? corners
            ? [
                t('walk.frame', { frame: frame + 1, total: tracking.frameCount }),
                face ? t(`faceTitle.${face}`) : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : t('walk.lost')
          : t('walk.label')}
      </p>
    </div>
  );
}
