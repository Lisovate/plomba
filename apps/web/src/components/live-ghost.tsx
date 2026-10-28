import type { FrameRegistration, Mark } from '@plomba/contracts';
import {
  applyHomography,
  type ContainerDimensions,
  type Face,
  faceToImage,
  type Point,
} from '@plomba/core';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { markShapeInImage } from './face-overlay.tsx';

/** Frames sent for registration: enough to find the container's outline. */
const FRAME_SIDE = 768;
/** How often the face is found again; tracking between updates is up to the checker's hands. */
const INTERVAL_MS = 1500;

async function grabFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const scale = Math.min(1, FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
}

const points = (shape: readonly Point[]) => shape.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * The previous handover's marks drawn over the live camera preview. The face
 * is found again in a fresh frame every 1.5 s (SAM 3.1 on the server; frames
 * aren't stored), and the marks are mapped onto it through the homography.
 */
export function LiveGhost({
  video,
  handoverId,
  face,
  dimensions,
  marks,
}: {
  video: HTMLVideoElement;
  handoverId: string;
  face: Face;
  dimensions: ContainerDimensions;
  marks: readonly Mark[];
}) {
  const { t } = useI18n();
  const [frame, setFrame] = useState<FrameRegistration | null>(null);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden || video.videoWidth === 0) return;
      busy = true;
      try {
        const blob = await grabFrame(video);
        const result = blob ? await api.registerFrame(handoverId, blob) : null;
        if (!cancelled && result) setFrame(result);
      } catch {
        // Keep showing the last registration; the next tick tries again.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, INTERVAL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [video, handoverId]);

  const h = useMemo(() => {
    if (!frame?.corners) return null;
    try {
      return faceToImage(face, dimensions, frame.corners);
    } catch {
      return null;
    }
  }, [frame, face, dimensions]);

  if (!frame?.corners || !h) {
    return <p className="live-status">{t('live.searching')}</p>;
  }
  const px = frame.width / 400;
  return (
    <>
      <svg
        className="live-ghost"
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <polygon points={points(frame.corners)} className="face-outline" strokeWidth={2 * px} />
        {marks.map((mark) => {
          const anchor = applyHomography(h, { x: mark.rect.u0, y: mark.rect.v1 });
          return (
            <g key={mark.id} className="mark-ghost">
              <polygon points={points(markShapeInImage(h, mark))} strokeWidth={2.5 * px} />
              <text x={anchor.x} y={anchor.y - 4 * px} fontSize={13 * px}>
                {[mark.locationCode, mark.damageCode].filter(Boolean).join(' ')}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="live-status">{t('live.ghosts')}</p>
    </>
  );
}
