import type { HandoverDetail, Mark, MarkStatus, Photo } from '@plomba/contracts';
import { DAMAGE_CODES, FACES, type Face, isDamageCode } from '@plomba/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { FacePanel } from '../components/face-panel.tsx';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

export function HandoverScreen() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const detail = useQuery({ queryKey: queryKeys.handover(id), queryFn: () => api.handover(id) });
  const [face, setFace] = useState<Face>('D');
  const [selectedMarkId, setSelectedMarkId] = useState<string>();

  const view = useMemo(() => (detail.data ? deriveView(detail.data) : undefined), [detail.data]);

  if (detail.isPending) return <Spinner label={t('common.loading')} />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => detail.refetch()} />;
  if (!view) return null;

  const { handover, container } = detail.data;
  const editable = handover.status === 'open';

  return (
    <div className="stack">
      <Card>
        <Link to={`/containers/${container.number}`} className="big-number">
          <ContainerNumberText value={container.number} />
        </Link>
        <p className="muted">
          {t(handover.direction === 'in' ? 'handover.in' : 'handover.out')} · {handover.place} ·{' '}
          {handover.checker}
        </p>
        <p className={editable ? 'badge' : 'badge ok'}>
          {t(editable ? 'handover.open' : 'handover.closed')}
        </p>
        <p className="muted">
          {t('handover.faces', { done: view.registeredFaces, total: FACES.length })}
        </p>
      </Card>

      <nav className="face-tabs" aria-label="Faces">
        {FACES.map((f) => {
          const pending =
            view.previousByFace.get(f)?.filter((m) => !view.resolved.has(m.id)).length ?? 0;
          const photo = view.photoByFace.get(f);
          return (
            <button
              type="button"
              key={f}
              className={[
                'face-tab',
                f === face ? 'selected' : '',
                photo?.corners ? 'done' : '',
              ].join(' ')}
              onClick={() => setFace(f)}
              aria-pressed={f === face}
            >
              {t(`faceTitle.${f}`)}
              {pending > 0 && <span className="count">{pending}</span>}
            </button>
          );
        })}
      </nav>

      <FacePanel
        key={face}
        handoverId={handover.id}
        editable={editable}
        face={face}
        container={container}
        photo={view.photoByFace.get(face)}
        marks={view.marksByFace.get(face) ?? []}
        previousMarks={view.previousByFace.get(face) ?? []}
        resolvedPrevious={view.resolved}
        selectedMarkId={selectedMarkId}
        onSelectMark={(mark) => setSelectedMarkId(mark.id)}
      />

      <PreviousMarks
        handoverId={handover.id}
        editable={editable}
        hasPrevious={handover.previousHandoverId !== null}
        marks={view.previousByFace.get(face) ?? []}
        resolved={view.resolved}
        photo={view.photoByFace.get(face)}
      />

      <MarksList
        handoverId={handover.id}
        editable={editable}
        marks={view.activeMarks}
        selectedMarkId={selectedMarkId}
        onSelect={(mark) => {
          setFace(mark.face);
          setSelectedMarkId(mark.id);
        }}
      />

      {editable ? <SealButton handoverId={handover.id} /> : <SealInfo detail={detail.data} />}
    </div>
  );
}

/** Groups the handover's data the way the screen shows it. */
function deriveView(detail: HandoverDetail) {
  const photoByFace = new Map<Face, Photo>();
  for (const photo of detail.photos) photoByFace.set(photo.face, photo); // latest wins
  const activeMarks = detail.marks.filter((m) => m.source !== 'rejected');
  const marksByFace = groupByFace(activeMarks);
  const previousByFace = groupByFace(detail.previousMarks);
  const resolved = new Set(
    activeMarks.map((m) => m.previousMarkId).filter((id): id is string => id !== null),
  );
  const registeredFaces = FACES.filter((f) => photoByFace.get(f)?.corners).length;
  return { photoByFace, activeMarks, marksByFace, previousByFace, resolved, registeredFaces };
}

function groupByFace(marks: readonly Mark[]): Map<Face, Mark[]> {
  const byFace = new Map<Face, Mark[]>();
  for (const mark of marks) byFace.set(mark.face, [...(byFace.get(mark.face) ?? []), mark]);
  return byFace;
}

function damageLabel(code: string | null): string {
  return code && isDamageCode(code) ? `${code} ${DAMAGE_CODES[code]}` : '—';
}

function PreviousMarks({
  handoverId,
  editable,
  hasPrevious,
  marks,
  resolved,
  photo,
}: {
  handoverId: string;
  editable: boolean;
  hasPrevious: boolean;
  marks: readonly Mark[];
  resolved: ReadonlySet<string>;
  photo: Photo | undefined;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: ({ mark, status }: { mark: Mark; status: MarkStatus }) =>
      api.addMark(handoverId, {
        face: mark.face,
        rect: mark.rect,
        damageCode: mark.damageCode,
        componentCode: mark.componentCode,
        status,
        source: 'confirmed',
        previousMarkId: mark.id,
        photoId: photo?.id ?? null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.handover(handoverId) }),
  });

  if (!hasPrevious) return <p className="muted">{t('handover.previousNone')}</p>;
  if (marks.length === 0) return null;
  const pending = marks.filter((m) => !resolved.has(m.id)).length;

  return (
    <section>
      <h2>
        {t('handover.previous')}{' '}
        {pending > 0 && (
          <span className="muted">· {t('handover.previousPending', { count: pending })}</span>
        )}
      </h2>
      <ul className="list">
        {marks.map((mark) => (
          <li key={mark.id} className="list-item ghost">
            <span>
              <code>{mark.locationCode}</code> {damageLabel(mark.damageCode)}
            </span>
            {resolved.has(mark.id) ? (
              <span className="badge ok">{t('mark.resolved')}</span>
            ) : (
              editable && (
                <div className="row wrap">
                  {(
                    [
                      ['still-there', 'mark.stillThere'],
                      ['changed', 'mark.changed'],
                      ['repaired', 'mark.repaired'],
                    ] as const
                  ).map(([status, label]) => (
                    <button
                      type="button"
                      key={status}
                      className="secondary small"
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate({ mark, status })}
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
              )
            )}
          </li>
        ))}
      </ul>
      {confirm.isError && <ErrorNotice error={confirm.error} />}
    </section>
  );
}

function MarksList({
  handoverId,
  editable,
  marks,
  selectedMarkId,
  onSelect,
}: {
  handoverId: string;
  editable: boolean;
  marks: readonly Mark[];
  selectedMarkId: string | undefined;
  onSelect: (mark: Mark) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const reject = useMutation({
    mutationFn: (mark: Mark) => api.updateMark(handoverId, mark.id, { source: 'rejected' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.handover(handoverId) }),
  });

  return (
    <section>
      <h2>{t('handover.marks')}</h2>
      {marks.length === 0 && <p className="muted">{t('handover.noMarks')}</p>}
      <ul className="list">
        {marks.map((mark) => (
          <li
            key={mark.id}
            className={mark.id === selectedMarkId ? 'list-item selected' : 'list-item'}
          >
            <button type="button" className="link" onClick={() => onSelect(mark)}>
              <code>{mark.locationCode}</code> {damageLabel(mark.damageCode)}
              {mark.componentCode && <span className="muted"> · {mark.componentCode}</span>}
            </button>
            <span className="muted">{t(`mark.status.${mark.status}`)}</span>
            {editable && (
              <button
                type="button"
                className="secondary small"
                disabled={reject.isPending}
                onClick={() => reject.mutate(mark)}
              >
                {t('mark.reject')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SealButton({ handoverId }: { handoverId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const seal = useMutation({
    mutationFn: () => api.closeHandover(handoverId),
    onSuccess: (handover) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recent }),
        queryClient.invalidateQueries({ queryKey: queryKeys.container(handover.containerNumber) }),
      ]),
  });
  return (
    <div className="stack">
      {seal.isError && <ErrorNotice error={seal.error} />}
      <button
        type="button"
        className="primary large"
        disabled={seal.isPending}
        onClick={() => {
          if (window.confirm(t('handover.sealConfirm'))) seal.mutate();
        }}
      >
        {t('handover.seal')}
      </button>
    </div>
  );
}

function SealInfo({ detail }: { detail: HandoverDetail }) {
  const { t } = useI18n();
  const seal = detail.handover.seal;
  if (!seal) return null;
  return (
    <Card className="sealed">
      <h2>{t('handover.sealed')}</h2>
      <p className="muted">
        #{seal.sequence + 1} ·{' '}
        {detail.handover.closedAt && new Date(detail.handover.closedAt).toLocaleString()}
      </p>
      <p>
        {t('handover.hash')}: <code className="hash">{seal.hash}</code>
      </p>
    </Card>
  );
}
