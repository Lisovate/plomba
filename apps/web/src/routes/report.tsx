import type { ContainerHistory, HandoverDetail, Mark } from '@plomba/contracts';
import { COMPONENT_CODES, DAMAGE_CODES, FACES, isComponentCode, isDamageCode } from '@plomba/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { ClaimPanel } from '../components/claim-panel.tsx';
import { DamageOrigin, useSealedHandovers } from '../components/container-passport.tsx';
import { FaceOverlay } from '../components/face-overlay.tsx';
import { ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { type Translate, useI18n } from '../i18n/index.tsx';
import { describeTransport } from '../lib/transport.ts';

/**
 * The equipment interchange receipt (EIR) for a sealed handover, laid out
 * for printing: the browser's Print → Save as PDF produces the document the
 * parties keep.
 */
export function ReportScreen() {
  const { id = '' } = useParams();
  const { t, language } = useI18n();
  const detail = useQuery({ queryKey: queryKeys.handover(id), queryFn: () => api.handover(id) });
  const containerNumber = detail.data?.container.number ?? '';
  const history = useQuery({
    queryKey: queryKeys.container(containerNumber),
    queryFn: () => api.containerHistory(containerNumber),
    enabled: containerNumber !== '',
  });
  const [recipient, setRecipient] = useState('');

  if (detail.isPending) return <Spinner label={t('common.loading')} />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => detail.refetch()} />;

  const { handover, container, photos, marks, previousMarks } = detail.data;
  const active = marks.filter((m) => m.source === 'confirmed');
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(language) : '—');
  const latestPhotos = FACES.flatMap((face) => {
    const photo = photos.filter((p) => p.face === face).at(-1);
    return photo ? [photo] : [];
  });

  return (
    <article className="report stack">
      <div className="row no-print">
        <Link to={`/handovers/${handover.id}`} className="button secondary">
          {t('common.back')}
        </Link>
        <button type="button" className="primary" onClick={() => window.print()}>
          {t('report.print')}
        </button>
      </div>

      <header>
        <h1>{t('report.title')}</h1>
        <p className="big-number">
          <ContainerNumberText value={container.number} />
        </p>
        <p>
          {container.sizeTypeCode ?? '—'} ·{' '}
          {t('container.dimensions', {
            length: container.dimensions.length.toFixed(2),
            width: container.dimensions.width.toFixed(2),
            height: container.dimensions.height.toFixed(2),
          })}
        </p>
      </header>

      <dl className="facts">
        <dt>{t('start.direction')}</dt>
        <dd>{t(handover.direction === 'in' ? 'handover.in' : 'handover.out')}</dd>
        <dt>{t('start.place')}</dt>
        <dd>{handover.place}</dd>
        <dt>{t('report.started')}</dt>
        <dd>{date(handover.startedAt)}</dd>
        <dt>{t('report.sealedAt')}</dt>
        <dd>{date(handover.closedAt)}</dd>
        <dt>{t('start.checker')}</dt>
        <dd>{handover.checker}</dd>
        <dt>{t('start.handedOverBy')}</dt>
        <dd>{handover.handedOverBy ?? '—'}</dd>
        <dt>{t('start.receivedBy')}</dt>
        <dd>{handover.receivedBy ?? '—'}</dd>
        <dt>{t('start.transport')}</dt>
        <dd>{describeTransport(t, handover) ?? '—'}</dd>
        <dt>{t('identify.seals')}</dt>
        <dd>{handover.sealNumbers.join(', ') || '—'}</dd>
      </dl>

      <section>
        <h2>{t('report.seal')}</h2>
        {handover.seal ? (
          <>
            <p>
              {t('report.chainPosition', { position: handover.seal.sequence + 1 })}
              {history.data &&
                ` · ${history.data.chain.ok ? t('report.chainOk') : t('container.chainBroken', { index: (history.data.chain.brokenAt ?? 0) + 1 })}`}
            </p>
            <p>
              {t('handover.hash')}: <code className="hash">{handover.seal.hash}</code>
            </p>
            <p>
              {t('report.previousHash')}: <code className="hash">{handover.seal.previousHash}</code>
            </p>
          </>
        ) : (
          <p className="notice">{t('report.notSealed')}</p>
        )}
      </section>

      <Comparison
        t={t}
        hasPrevious={handover.previousHandoverId !== null}
        previous={previousMarks}
        current={active}
      />

      <section>
        <h2>{t('report.damage')}</h2>
        {active.length === 0 ? (
          <p>{t('handover.noMarks')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('report.location')}</th>
                <th>{t('mark.damage')}</th>
                <th>{t('mark.component')}</th>
                <th>{t('report.status')}</th>
                <th>{t('report.firstRecorded')}</th>
                <th>{t('mark.note')}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id}>
                  <td>
                    <code>{m.locationCode}</code>
                  </td>
                  <td>{codeLabel(m.damageCode, 'damage')}</td>
                  <td>{codeLabel(m.componentCode, 'component')}</td>
                  <td>{t(`mark.status.${m.status}`)}</td>
                  <td>
                    <FirstRecorded mark={m} handoverId={handover.id} history={history.data} />
                  </td>
                  <td>{m.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>{t('report.photos')}</h2>
        <div className="report-photos">
          {latestPhotos.map((photo) => (
            <figure key={photo.id}>
              <FaceOverlay
                photo={photo}
                face={photo.face}
                dimensions={container.dimensions}
                corners={photo.corners}
                marks={active.filter((m) => m.face === photo.face)}
                previousMarks={[]}
                resolvedPrevious={new Set()}
                mode="view"
                label={t(`faceTitle.${photo.face}`)}
              />
              <figcaption>
                {t(`faceTitle.${photo.face}`)} · {date(photo.capturedAt)} · SHA-256{' '}
                <code className="hash">{photo.sha256.slice(0, 16)}…</code>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="signatures">
        {[
          handover.handedOverBy ?? t('start.handedOverBy'),
          handover.receivedBy ?? t('start.receivedBy'),
          handover.checker,
        ].map((name, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: three fixed signature lines
          <div key={index} className="signature">
            <span>{name}</span>
          </div>
        ))}
      </section>

      {handover.seal &&
        active.some((m) => m.previousMarkId === null) &&
        handover.previousHandoverId && <ClaimPanel handoverId={handover.id} />}

      {handover.seal && (
        <section className="no-print card">
          <h2>{t('report.codeco')}</h2>
          <p className="muted">{t('report.codecoHint')}</p>
          <label className="field">
            {t('report.recipient')}
            <input
              value={recipient}
              autoCapitalize="characters"
              onChange={(e) => setRecipient(e.target.value.toUpperCase())}
            />
          </label>
          <a
            className="button secondary"
            href={`/api/handovers/${handover.id}/codeco?recipient=${encodeURIComponent(recipient || 'RECIPIENT')}`}
            download
          >
            {t('report.downloadCodeco')}
          </a>
        </section>
      )}
    </article>
  );
}

/**
 * Where a damage on this receipt was first recorded, and the handovers it
 * happened between, from the container's sealed records. "—" wherever the
 * records can't say: not loaded, a broken chain, or an earlier mark not found.
 */
function FirstRecorded({
  mark,
  handoverId,
  history,
}: {
  mark: Mark;
  handoverId: string;
  history: ContainerHistory | undefined;
}) {
  const { t } = useI18n();
  const { name } = useSealedHandovers(history?.handovers ?? []);
  if (!history?.chain.ok) return <>—</>;
  // Sealed: this mark is in a history. Not sealed yet: the mark it confirms may be.
  const found = history.damage.find((d) =>
    d.trail.some((step) => step.markId === mark.id || step.markId === mark.previousMarkId),
  );
  if (!found) return <>{mark.previousMarkId ? '—' : t('report.here')}</>;
  if (found.firstRecorded !== handoverId) return <>{name(found.firstRecorded)}</>;
  return (
    <>
      {t('report.here')}
      <span className="origin">
        <DamageOrigin history={found} name={name} />
      </span>
    </>
  );
}

function codeLabel(code: string | null, list: 'damage' | 'component'): string {
  if (!code) return '—';
  if (list === 'damage' && isDamageCode(code)) return `${code} ${DAMAGE_CODES[code]}`;
  if (list === 'component' && isComponentCode(code)) return `${code} ${COMPONENT_CODES[code]}`;
  return code;
}

/** What happened to each mark of the previous handover, and what is new. */
function Comparison({
  t,
  hasPrevious,
  previous,
  current,
}: {
  t: Translate;
  hasPrevious: boolean;
  previous: HandoverDetail['previousMarks'];
  current: readonly Mark[];
}) {
  if (!hasPrevious) {
    return (
      <section>
        <h2>{t('report.comparison')}</h2>
        <p>{t('handover.previousNone')}</p>
      </section>
    );
  }
  const followUp = new Map(
    current.flatMap((m) => (m.previousMarkId ? [[m.previousMarkId, m]] : [])),
  );
  const added = current.filter((m) => m.previousMarkId === null);
  return (
    <section>
      <h2>{t('report.comparison')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('report.location')}</th>
            <th>{t('mark.damage')}</th>
            <th>{t('report.then')}</th>
            <th>{t('report.now')}</th>
          </tr>
        </thead>
        <tbody>
          {previous.map((m) => {
            const now = followUp.get(m.id);
            return (
              <tr key={m.id}>
                <td>
                  <code>{m.locationCode}</code>
                </td>
                <td>{codeLabel(m.damageCode, 'damage')}</td>
                <td>{t('report.recorded')}</td>
                <td>{now ? t(`mark.status.${now.status}`) : t('report.notChecked')}</td>
              </tr>
            );
          })}
          {added.map((m) => (
            <tr key={m.id} className="new-damage">
              <td>
                <code>{m.locationCode}</code>
              </td>
              <td>{codeLabel(m.damageCode, 'damage')}</td>
              <td>—</td>
              <td>
                <strong>{t('report.newDamage')}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
