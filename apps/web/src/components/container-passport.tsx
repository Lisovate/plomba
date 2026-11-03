import type { Container, DamageHistory, Handover } from '@plomba/contracts';
import { DAMAGE_CODES, type Face, faceCells, faceSize, isDamageCode } from '@plomba/core';
import { useI18n } from '../i18n/index.tsx';
import { describeTransport } from '../lib/transport.ts';

/** One colour per sealed handover, in chain order. */
const PALETTE = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#ea580c', '#0891b2', '#be185d'];

/** Gap between faces and room for their titles, in metres. */
const GAP = 0.4;
const TITLE = 0.75;

interface Placed {
  readonly face: Face;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Each long side followed by the end it meets on its right (as seen from
 * outside), then the roof: the left side meets the doors, the right side the
 * front. Positions in metres, y down.
 */
function layout(container: Container): { faces: Placed[]; width: number; height: number } {
  const { dimensions } = container;
  const side = faceSize('L', dimensions);
  const end = faceSize('D', dimensions);
  const roof = faceSize('T', dimensions);
  const rows: [Face, Face | null][] = [
    ['L', 'D'],
    ['R', 'F'],
    ['T', null],
  ];
  const faces: Placed[] = [];
  let y = 0;
  for (const [long, short] of rows) {
    const height = long === 'T' ? roof.height : side.height;
    faces.push({ face: long, x: 0, y: y + TITLE, width: side.width, height });
    if (short) {
      faces.push({ face: short, x: side.width + GAP, y: y + TITLE, ...end });
    }
    y += TITLE + height + GAP;
  }
  return { faces, width: side.width + GAP + end.width, height: y - GAP };
}

function damageName(code: string | null): string {
  return code && isDamageCode(code) ? `${code} ${DAMAGE_CODES[code]}` : '';
}

/**
 * The container's sealed handovers in chain order, with a colour and a label
 * ("#2 Gate out · Łódź · 4.11.2026") for each, as the passport shows them.
 */
export function useSealedHandovers(handovers: readonly Handover[]) {
  const { t, language } = useI18n();
  const sealed = handovers
    .filter((h) => h.seal)
    .sort((a, b) => (a.seal?.sequence ?? 0) - (b.seal?.sequence ?? 0));
  const order = new Map(sealed.map((h, i) => [h.id, i]));
  const colour = (handoverId: string) => PALETTE[(order.get(handoverId) ?? 0) % PALETTE.length];
  const name = (handoverId: string) => {
    const i = order.get(handoverId);
    const h = i === undefined ? undefined : sealed[i];
    if (!h || i === undefined) return '—';
    return t('passport.handover', {
      n: i + 1,
      direction: t(h.direction === 'in' ? 'handover.in' : 'handover.out'),
      place: h.place,
      date: new Date(h.closedAt ?? h.startedAt).toLocaleDateString(language),
    });
  };
  return { sealed, colour, name };
}

/**
 * The container's damage passport: every damage on a map of its faces,
 * coloured by the sealed handover that first recorded it, and for each one
 * the handovers it happened between.
 */
export function ContainerPassport({
  container,
  handovers,
  damage,
  chainOk,
}: {
  container: Container;
  handovers: readonly Handover[];
  damage: readonly DamageHistory[];
  /** Whether the hash chain verifies; a broken chain is no evidence of anything. */
  chainOk: boolean;
}) {
  const { t } = useI18n();
  const { sealed, colour, name } = useSealedHandovers(handovers);
  const { faces, width, height } = layout(container);

  if (sealed.length === 0) return null;
  if (!chainOk) {
    return (
      <section className="passport">
        <h2>{t('passport.title')}</h2>
        <p className="notice error">{t('passport.broken')}</p>
      </section>
    );
  }

  return (
    <section className="passport">
      <h2>{t('passport.title')}</h2>
      <p className="muted">{t('passport.intro')}</p>

      <svg
        className="passport-map"
        viewBox={`-0.1 -0.1 ${width + 0.2} ${height + 0.2}`}
        role="img"
        aria-label={t('passport.mapLabel')}
      >
        {faces.map((placed) => (
          <FaceMap
            key={placed.face}
            placed={placed}
            container={container}
            damage={damage.filter((d) => d.face === placed.face)}
            colour={colour}
          />
        ))}
      </svg>

      <ol className="passport-legend">
        {sealed.map((h) => (
          <li key={h.id}>
            <span className="swatch" style={{ background: colour(h.id) }} aria-hidden />
            {name(h.id)}
            {describeTransport(t, h) && <span className="muted"> · {describeTransport(t, h)}</span>}
          </li>
        ))}
      </ol>

      {damage.length === 0 ? (
        <p className="muted">{t('passport.none')}</p>
      ) : (
        <ul className="list">
          {damage.map((d) => (
            <li key={d.id} className="list-item passport-item">
              <span>
                <span
                  className="swatch"
                  style={{ background: colour(d.firstRecorded) }}
                  aria-hidden
                />
                <code>{d.locationCode}</code> {damageName(d.damageCode)}{' '}
                <span className="muted">· {t(`mark.status.${d.status}`)}</span>
              </span>
              <span>{t('passport.firstRecorded', { handover: name(d.firstRecorded) })}</span>
              <DamageOrigin history={d} name={name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Where a damage comes from, in words: the two handovers it happened between,
 * or why that can't be said (an earlier record on the same spot, no photo).
 */
export function DamageOrigin({
  history,
  name,
}: {
  history: DamageHistory;
  name: (handoverId: string) => string;
}) {
  const { t } = useI18n();
  const { lastClear, notInspectedAt, recordedNearbyAt } = history;
  return (
    <>
      {recordedNearbyAt ? (
        <span>{t('passport.recordedNearby', { handover: name(recordedNearbyAt) })}</span>
      ) : lastClear ? (
        <span>
          {t('passport.lastClear', { handover: name(lastClear) })}{' '}
          <strong>{t('passport.between')}</strong>
        </span>
      ) : (
        notInspectedAt.length === 0 && <span className="muted">{t('passport.alreadyThere')}</span>
      )}
      {notInspectedAt.length > 0 && (
        <span className="muted">
          {t('passport.notInspected', { handovers: notInspectedAt.map(name).join('; ') })}
        </span>
      )}
    </>
  );
}

function FaceMap({
  placed,
  container,
  damage,
  colour,
}: {
  placed: Placed;
  container: Container;
  damage: readonly DamageHistory[];
  colour: (handoverId: string) => string | undefined;
}) {
  const { t } = useI18n();
  const { face, x, y, width, height } = placed;
  // Face coordinates have v up; the drawing has y down.
  const toY = (v: number) => y + height - v;
  return (
    <g>
      <text x={x} y={y - 0.2} className="passport-title">
        {t(`faceTitle.${face}`)}
      </text>
      <rect x={x} y={y} width={width} height={height} className="passport-face" />
      {faceCells(face, container.dimensions).map((cell) => (
        <rect
          key={cell.code}
          x={x + cell.rect.u0}
          y={toY(cell.rect.v1)}
          width={cell.rect.u1 - cell.rect.u0}
          height={cell.rect.v1 - cell.rect.v0}
          className="passport-cell"
        />
      ))}
      {damage.map((d) => {
        const stroke = colour(d.firstRecorded);
        // The label goes above the damage, or inside it where the face title would be in the way.
        const roomAbove = d.rect.v1 <= height - 0.45;
        return (
          <g
            key={d.id}
            className={d.status === 'repaired' ? 'passport-mark repaired' : 'passport-mark'}
          >
            <rect
              x={x + d.rect.u0}
              y={toY(d.rect.v1)}
              width={Math.max(0.08, d.rect.u1 - d.rect.u0)}
              height={Math.max(0.08, d.rect.v1 - d.rect.v0)}
              stroke={stroke}
              fill={stroke}
            />
            <text
              x={x + d.rect.u0 + (roomAbove ? 0 : 0.08)}
              y={roomAbove ? toY(d.rect.v1) - 0.08 : toY(d.rect.v1) + 0.42}
              fill={stroke}
            >
              {[d.locationCode, d.damageCode].filter(Boolean).join(' ')}
            </text>
          </g>
        );
      })}
    </g>
  );
}
