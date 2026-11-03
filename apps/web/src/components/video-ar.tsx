import type { HandoverDetail, Mark, VideoTracking } from '@plomba/contracts';
import {
  applyHomography,
  type Face,
  faceCells,
  faceToImage,
  type Homography,
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

type TrackedFrame = VideoTracking['frames'][number];

/** What is in view at a frame: one face square-on, or the two faces of a corner. */
export type FrameView =
  | { readonly face: Face }
  | { readonly corner: { readonly left: Face; readonly right: Face } };

/** The tracked frame for a frame: the latest tracked frame at or before it, if recent. */
function trackedAt(tracking: VideoTracking, frame: number): TrackedFrame | null {
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
  return hit && frame - hit.frame <= MAX_GAP ? hit : null;
}

/** The faces to draw, each with the outline it occupies in the frame. */
function facesInView(tracked: TrackedFrame, view: FrameView | null): { face: Face; quad: Quad }[] {
  if (!view) return [];
  if ('face' in view) return [{ face: view.face, quad: tracked.corners }];
  if (!tracked.split) return [];
  return [
    { face: view.corner.left, quad: tracked.split.left },
    { face: view.corner.right, quad: tracked.split.right },
  ];
}

interface VideoArProps {
  readonly src: string;
  readonly tracking: VideoTracking | undefined;
  readonly detail: HandoverDetail;
  /** What is in view at a frame, or `null` where it isn't known. */
  readonly viewAt: (frame: number) => FrameView | null;
}

/**
 * Plays a recorded clip with the container's coordinates drawn on it, frame
 * by frame from SAM 3.1's tracking: the CEDEX sections of the faces in view,
 * the previous handover's damage (dashed) and this handover's damage. Seen
 * corner-on, both faces are drawn, each on its side of the near edge; where
 * the faces aren't known, only the container's outline.
 */
export function VideoAr({ src, tracking, detail, viewAt }: VideoArProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState(0);
  const { dimensions } = detail.container;

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

  const tracked = tracking ? trackedAt(tracking, frame) : null;
  const view = viewAt(frame);
  const drawn = useMemo(() => {
    if (!tracked) return [];
    return facesInView(tracked, view).flatMap(({ face, quad }) => {
      try {
        return [{ face, quad, h: faceToImage(face, dimensions, quad) }];
      } catch {
        return [];
      }
    });
  }, [tracked, view, dimensions]);
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
          {tracked && drawn.length === 0 && (
            <polygon
              points={points(tracked.corners)}
              className="face-outline faint"
              strokeWidth={2 * px}
            />
          )}
          {drawn.map(({ face, quad, h }, i) => (
            <FaceLayer
              // biome-ignore lint/suspicious/noArrayIndexKey: one layer per side of a corner, which may share a face
              key={`${i}-${face}`}
              face={face}
              quad={quad}
              h={h}
              detail={detail}
              px={px}
            />
          ))}
        </svg>
      )}
      <p className="live-status">
        {tracking
          ? tracked
            ? [
                t('walk.frame', { frame: frame + 1, total: tracking.frameCount }),
                drawn.map((d) => t(`faceTitle.${d.face}`)).join(' | ') || null,
              ]
                .filter(Boolean)
                .join(' · ')
            : t('walk.lost')
          : t('walk.label')}
      </p>
    </div>
  );
}

/** One face's sections, outline and damage, drawn through its homography. */
function FaceLayer({
  face,
  quad,
  h,
  detail,
  px,
}: {
  face: Face;
  quad: Quad;
  h: Homography;
  detail: HandoverDetail;
  px: number;
}) {
  const { dimensions } = detail.container;
  const marks: { mark: Mark; ghost: boolean }[] = [
    ...detail.previousMarks.filter((m) => m.face === face).map((mark) => ({ mark, ghost: true })),
    ...detail.marks
      .filter((m) => m.face === face && m.source !== 'rejected')
      .map((mark) => ({ mark, ghost: false })),
  ];
  return (
    <g>
      {faceCells(face, dimensions).map((cell) => (
        <polygon
          key={cell.code}
          points={points(projectFaceRect(h, cell.rect))}
          className="grid-cell"
          strokeWidth={1 * px}
        />
      ))}
      <polygon points={points(quad)} className="face-outline" strokeWidth={2 * px} />
      {marks.map(({ mark, ghost }) => {
        const anchor = applyHomography(h, { x: mark.rect.u0, y: mark.rect.v1 });
        return (
          <g key={mark.id} className={ghost ? 'mark-ghost' : 'mark'}>
            <polygon points={points(markShapeInImage(h, mark))} strokeWidth={2 * px} />
            <text x={anchor.x} y={anchor.y - 3 * px} fontSize={11 * px}>
              {[mark.locationCode, mark.damageCode].filter(Boolean).join(' ')}
            </text>
          </g>
        );
      })}
    </g>
  );
}
