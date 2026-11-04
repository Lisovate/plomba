import type { ContainerHistory, HandoverDetail, Mark, VideoTracking } from '@plomba/contracts';
import {
  applyHomography,
  type ContainerDimensions,
  DEFAULT_DIMENSIONS,
  type Face,
  faceCells,
  faceToImage,
  type Homography,
  type Point,
  projectFaceRect,
  type Quad,
  quadArea,
} from '@plomba/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { firstRecordedLabel, informationLines, openDamageInView } from '../lib/passport-ar.ts';
import type { FrameView } from '../lib/video-analysis.ts';
import { markShapeInImage } from './face-overlay.tsx';
import { ContainerNumberText } from './ui.tsx';

export type { FrameView } from '../lib/video-analysis.ts';

export interface VideoArLayers {
  readonly outlineGrid: boolean;
  readonly damage: boolean;
  readonly information: boolean;
}

const ALL_LAYERS: VideoArLayers = { outlineGrid: true, damage: true, information: true };

const points = (shape: readonly Point[]) => shape.map((p) => `${p.x},${p.y}`).join(' ');

/** A tracked frame is used for up to this many frames after it, if later ones are missing. */
const MAX_GAP = 3;

type TrackedFrame = VideoTracking['frames'][number];

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
  if ('face' in view) {
    // Seen at an angle, the outline covers two faces: the named one is the larger part.
    const { split } = tracked;
    const quad = split
      ? quadArea(split.left) >= quadArea(split.right)
        ? split.left
        : split.right
      : tracked.corners;
    return [{ face: view.face, quad }];
  }
  if (!tracked.split) return [];
  return [
    { face: view.corner.left, quad: tracked.split.left },
    { face: view.corner.right, quad: tracked.split.right },
  ];
}

interface VideoArProps {
  readonly src: string;
  readonly tracking: VideoTracking | undefined;
  readonly detail?: HandoverDetail;
  /** A sample's linked container, without creating a handover. */
  readonly passport?: ContainerHistory | undefined;
  readonly layers?: VideoArLayers;
  readonly autoPlay?: boolean;
  /** What is in view at a frame, or `null` where it isn't known. */
  readonly viewAt: (frame: number, fps: number) => FrameView | null;
}

/**
 * Plays a recorded clip with the container's coordinates drawn on it, frame
 * by frame from SAM 3.1's tracking: the CEDEX sections of the faces in view,
 * the previous handover's damage (dashed) and this handover's damage. Seen
 * corner-on, both faces are drawn, each on its side of the near edge; where
 * the faces aren't known, only the container's outline.
 */
export function VideoAr({
  src,
  tracking,
  detail,
  passport,
  layers = ALL_LAYERS,
  viewAt,
  autoPlay = false,
}: VideoArProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState(0);
  const [duration, setDuration] = useState(0);
  const dimensions =
    passport?.container.dimensions ?? detail?.container.dimensions ?? DEFAULT_DIMENSIONS;
  const [displayWidth, setDisplayWidth] = useState(600);
  const [tagHeight, setTagHeight] = useState(112);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setDisplayWidth(entry.contentRect.width);
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  // Follow the frame on screen: per presented frame where the browser supports it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !tracking) return;
    let handle = 0;
    let stopped = false;
    const fps = () => tracking.frameCount / (video.duration || 1);
    const update = (mediaTime: number) => setFrame(Math.round(mediaTime * fps()));
    // Analysis may finish after the checker paused the clip.
    update(video.currentTime);
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
  const view = viewAt(frame, (tracking?.frameCount ?? 0) / (duration || 1));
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
  const px = (size?.width ?? 854) / displayWidth;
  const highestPoint = useMemo(
    () =>
      tracking?.frames.reduce((top, f) => Math.min(top, ...f.corners.map((p) => p.y)), Infinity) ??
      Infinity,
    [tracking],
  );
  // A phone may leave less room above the container than the readable tag needs.
  const headroom =
    passport && layers.information
      ? Math.max(0, tagHeight + 20 - Math.max(0, highestPoint) / px)
      : 0;

  return (
    <div className="overlay-frame video-ar" style={{ paddingTop: headroom }}>
      <video
        ref={videoRef}
        src={src}
        controls
        muted
        playsInline
        autoPlay={autoPlay}
        loop
        onLoadedMetadata={(e) => {
          setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight });
          setDuration(e.currentTarget.duration);
        }}
      />
      {size && tracking && (
        <svg
          className="overlay passive"
          style={{ top: headroom, height: `calc(100% - ${headroom}px)` }}
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {layers.outlineGrid && tracked && drawn.length === 0 && (
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
              passport={passport}
              dimensions={dimensions}
              layers={layers}
              px={px}
            />
          ))}
        </svg>
      )}
      {size && tracked && passport && layers.information && (
        <InformationTag
          history={passport}
          corners={tracked.corners}
          size={size}
          displayWidth={displayWidth}
          headroom={headroom}
          height={tagHeight}
          onHeight={setTagHeight}
        />
      )}
      <p
        className={
          passport && layers.information ? 'live-status video-status-bottom' : 'live-status'
        }
      >
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
  passport,
  dimensions,
  layers,
  px,
}: {
  face: Face;
  quad: Quad;
  h: Homography;
  detail: HandoverDetail | undefined;
  passport: ContainerHistory | undefined;
  dimensions: ContainerDimensions;
  layers: VideoArLayers;
  px: number;
}) {
  const { t, language } = useI18n();
  const marks: { mark: Mark; ghost: boolean }[] = [
    ...(detail?.previousMarks ?? [])
      .filter((m) => m.face === face)
      .map((mark) => ({ mark, ghost: true })),
    ...(detail?.marks ?? [])
      .filter((m) => m.face === face && m.source !== 'rejected')
      .map((mark) => ({ mark, ghost: false })),
  ];
  return (
    <g>
      {layers.outlineGrid &&
        faceCells(face, dimensions).map((cell) => (
          <polygon
            key={cell.code}
            points={points(projectFaceRect(h, cell.rect))}
            className="grid-cell"
            strokeWidth={1 * px}
          />
        ))}
      {layers.outlineGrid && (
        <>
          <polygon points={points(quad)} className="face-outline" strokeWidth={2 * px} />
          <text
            x={quad[0].x + 6 * px}
            y={quad[0].y + 18 * px}
            fontSize={13 * px}
            className="video-face-name"
          >
            {t(`faceTitle.${face}`)}
          </text>
        </>
      )}
      {layers.damage &&
        marks.map(({ mark, ghost }) => {
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
      {layers.damage &&
        passport &&
        openDamageInView(passport, [face]).map((damage) => {
          const anchor = applyHomography(h, { x: damage.rect.u0, y: damage.rect.v1 });
          return (
            <g key={damage.id} className="mark-ghost passport-ghost">
              <polygon points={points(projectFaceRect(h, damage.rect))} strokeWidth={2 * px} />
              <text x={anchor.x} y={anchor.y - 19 * px} fontSize={12 * px}>
                <tspan x={anchor.x}>
                  {[damage.locationCode, damage.damageCode].filter(Boolean).join(' ')}
                </tspan>
                <tspan x={anchor.x} dy={15 * px}>
                  {firstRecordedLabel(damage, passport.handovers, t, language)}
                </tspan>
              </text>
            </g>
          );
        })}
    </g>
  );
}

/** Keep the tag near the tracked top edge, and inside the player on a narrow phone. */
function InformationTag({
  history,
  corners,
  size,
  displayWidth,
  headroom,
  height,
  onHeight,
}: {
  history: ContainerHistory;
  corners: Quad;
  size: { width: number; height: number };
  displayWidth: number;
  headroom: number;
  height: number;
  onHeight: (height: number) => void;
}) {
  const { t, language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) onHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onHeight]);
  const scale = displayWidth / size.width;
  // Compact on a phone, where the tag sits over a landscape clip a few centimetres tall.
  const width = Math.min(displayWidth < 480 ? 232 : 288, displayWidth - 16);
  const x = ((corners[0].x + corners[1].x) / 2) * scale;
  const y = Math.min(...corners.map((point) => point.y)) * scale;
  const left = Math.max(8, Math.min(displayWidth - width - 8, x - width / 2));
  const top = Math.max(8, headroom + y - height - 12);
  const lines = informationLines(history, t, language);
  return (
    <div ref={ref} className="video-info" style={{ left, top, width }}>
      <strong>
        <ContainerNumberText value={history.container.number} />
      </strong>
      <span>{lines.sizeType}</span>
      <span>{lines.lastHandover}</span>
      <span
        className={`pill ${history.chain.ok ? (history.chain.length > 0 ? 'ok' : '') : 'error'}`}
      >
        {lines.chain}
      </span>
    </div>
  );
}
