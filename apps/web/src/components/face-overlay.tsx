import type { Mark, Photo } from '@plomba/contracts';
import {
  applyHomography,
  type ContainerDimensions,
  clampToFace,
  type Face,
  type FaceRect,
  faceCells,
  faceToImage,
  type Homography,
  imagePointsToFaceRect,
  invertHomography,
  type Point,
  projectFaceRect,
  type Quad,
} from '@plomba/core';
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';

export type OverlayMode = 'view' | 'corners' | 'draw';

interface FaceOverlayProps {
  readonly photo: Photo;
  readonly face: Face;
  readonly dimensions: ContainerDimensions;
  /** The face's corners in the photo; `null` until registered. */
  readonly corners: Quad | null;
  readonly marks: readonly Mark[];
  /** Marks from the previous handover, drawn as ghosts. */
  readonly previousMarks: readonly Mark[];
  /** Previous marks the checker has already confirmed in this handover. */
  readonly resolvedPrevious: ReadonlySet<string>;
  /** CEDEX cells with photographic evidence in this handover. */
  readonly coveredCells?: ReadonlySet<string> | undefined;
  readonly mode: OverlayMode;
  /** Accessible name, e.g. "Door end with 2 marks". */
  readonly label: string;
  readonly selectedMarkId?: string | undefined;
  readonly onCornersChange?: (corners: Quad) => void;
  readonly onDraw?: (rect: FaceRect) => void;
  readonly onSelectMark?: (mark: Mark) => void;
}

/** Corners placed inset from the photo's edges, for the checker to drag into place. */
export function defaultCorners(photo: Photo): Quad {
  const dx = photo.width * 0.1;
  const dy = photo.height * 0.15;
  return [
    { x: dx, y: dy },
    { x: photo.width - dx, y: dy },
    { x: photo.width - dx, y: photo.height - dy },
    { x: dx, y: photo.height - dy },
  ];
}

const points = (shape: readonly Point[]) => shape.map((p) => `${p.x},${p.y}`).join(' ');

function tryHomography(face: Face, dimensions: ContainerDimensions, corners: Quad | null) {
  if (!corners) return null;
  try {
    return faceToImage(face, dimensions, corners);
  } catch {
    return null;
  }
}

/**
 * A photo of one face with the container's own coordinate system drawn over
 * it: the CEDEX section grid, this handover's marks and the previous
 * handover's marks, all mapped from metres on the face to pixels through the
 * face's homography.
 */
export function FaceOverlay(props: FaceOverlayProps) {
  const { photo, face, dimensions, corners, mode } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [displayWidth, setDisplayWidth] = useState(photo.width);
  const [dragHandle, setDragHandle] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<{ start: Point; end: Point } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setDisplayWidth(entry.contentRect.width || photo.width);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [photo.width]);

  // Sizes in image pixels that look the same on any screen.
  const px = photo.width / displayWidth;
  const h = useMemo(() => tryHomography(face, dimensions, corners), [face, dimensions, corners]);
  const cells = useMemo(
    () =>
      h ? faceCells(face, dimensions).map((c) => ({ ...c, quad: projectFaceRect(h, c.rect) })) : [],
    [h, face, dimensions],
  );

  const toImage = (event: PointerEvent<SVGSVGElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * photo.width,
      y: ((event.clientY - box.top) / box.height) * photo.height,
    };
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const p = toImage(event);
    if (mode === 'corners' && corners) {
      const nearest = nearestCorner(corners, p);
      if (Math.hypot(nearest.point.x - p.x, nearest.point.y - p.y) < 48 * px) {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragHandle(nearest.index);
      }
    } else if (mode === 'draw' && h) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawing({ start: p, end: p });
    }
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const p = clampPoint(toImage(event), photo);
    if (dragHandle !== null && corners) {
      const next = [...corners] as [Point, Point, Point, Point];
      next[dragHandle] = p;
      props.onCornersChange?.(next);
    } else if (drawing) {
      setDrawing({ ...drawing, end: p });
    }
  };

  const onPointerUp = () => {
    setDragHandle(null);
    if (drawing && h) {
      const { start, end } = drawing;
      setDrawing(null);
      if (Math.abs(end.x - start.x) < 12 * px || Math.abs(end.y - start.y) < 12 * px) return;
      const rect = imagePointsToFaceRect(invertHomography(h), [
        start,
        end,
        { x: start.x, y: end.y },
        { x: end.x, y: start.y },
      ]);
      props.onDraw?.(clampToFace(face, rect, dimensions));
    }
  };

  return (
    <div className="overlay-frame">
      <img src={photo.url} width={photo.width} height={photo.height} alt="" draggable={false} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${photo.width} ${photo.height}`}
        className={`overlay overlay-${mode}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <title>{props.label}</title>
        {h && corners && (
          <>
            {cells.map((cell) => (
              <polygon
                key={cell.code}
                points={points(cell.quad)}
                className={props.coveredCells?.has(cell.code) ? 'grid-cell covered' : 'grid-cell'}
                strokeWidth={1.5 * px}
              />
            ))}
            <polygon points={points(corners)} className="face-outline" strokeWidth={3 * px} />
            {props.previousMarks.map((mark) => (
              <MarkShape
                key={mark.id}
                mark={mark}
                h={h}
                px={px}
                className={
                  props.resolvedPrevious.has(mark.id) ? 'mark-ghost resolved' : 'mark-ghost'
                }
              />
            ))}
            {props.marks.map((mark) => (
              <MarkShape
                key={mark.id}
                mark={mark}
                h={h}
                px={px}
                className={[
                  'mark',
                  mark.source === 'proposed' ? 'proposed' : '',
                  mark.id === props.selectedMarkId ? 'selected' : '',
                ].join(' ')}
                onSelect={props.onSelectMark}
              />
            ))}
          </>
        )}
        {mode === 'corners' &&
          corners?.map((corner, index) => (
            <circle
              // Corners have a fixed order (TL, TR, BR, BL).
              // biome-ignore lint/suspicious/noArrayIndexKey: positions are the identity here
              key={index}
              cx={corner.x}
              cy={corner.y}
              r={16 * px}
              className={dragHandle === index ? 'handle active' : 'handle'}
              strokeWidth={3 * px}
            />
          ))}
        {drawing && (
          <rect
            x={Math.min(drawing.start.x, drawing.end.x)}
            y={Math.min(drawing.start.y, drawing.end.y)}
            width={Math.abs(drawing.end.x - drawing.start.x)}
            height={Math.abs(drawing.end.y - drawing.start.y)}
            className="drawing"
            strokeWidth={3 * px}
          />
        )}
      </svg>
    </div>
  );
}

/** A mark's outline in the photo: its traced outline if it has one, else its rectangle. */
export function markShapeInImage(h: Homography, mark: Mark): Point[] {
  return mark.outline
    ? mark.outline.map((p) => applyHomography(h, p))
    : [...projectFaceRect(h, mark.rect)];
}

function MarkShape({
  mark,
  h,
  px,
  className,
  onSelect,
}: {
  mark: Mark;
  h: Homography;
  px: number;
  className: string;
  onSelect?: ((mark: Mark) => void) | undefined;
}) {
  const shape = markShapeInImage(h, mark);
  const anchor = applyHomography(h, { x: mark.rect.u0, y: mark.rect.v1 });
  const label = [mark.locationCode, mark.damageCode].filter(Boolean).join(' ');
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: marks are also listed as buttons below the photo
    <g className={className} onClick={onSelect ? () => onSelect(mark) : undefined}>
      <polygon points={points(shape)} strokeWidth={3 * px} />
      <text x={anchor.x} y={anchor.y - 6 * px} fontSize={18 * px}>
        {label}
      </text>
    </g>
  );
}

function nearestCorner(corners: Quad, p: Point): { index: number; point: Point } {
  let best = { index: 0, point: corners[0], distance: Number.POSITIVE_INFINITY };
  corners.forEach((corner, index) => {
    const distance = Math.hypot(corner.x - p.x, corner.y - p.y);
    if (distance < best.distance) best = { index, point: corner, distance };
  });
  return best;
}

function clampPoint(p: Point, photo: Photo): Point {
  return {
    x: Math.min(Math.max(p.x, 0), photo.width),
    y: Math.min(Math.max(p.y, 0), photo.height),
  };
}
