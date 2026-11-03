import type { Container, Mark, Photo, SpokenDamageResult } from '@plomba/contracts';
import { type Face, type FaceRect, locationCode, type Quad } from '@plomba/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { prepareUpload } from '../lib/image.ts';
import { CameraCapture } from './camera-capture.tsx';
import { defaultCorners, FaceOverlay, type OverlayMode } from './face-overlay.tsx';
import { LiveGhost } from './live-ghost.tsx';
import { MarkForm } from './mark-form.tsx';
import { RecordButton } from './record-button.tsx';
import { ErrorNotice, Spinner } from './ui.tsx';

interface FacePanelProps {
  readonly handoverId: string;
  readonly editable: boolean;
  readonly face: Face;
  readonly container: Container;
  /** The latest photo of this face, if any. */
  readonly photo: Photo | undefined;
  readonly marks: readonly Mark[];
  readonly previousMarks: readonly Mark[];
  readonly resolvedPrevious: ReadonlySet<string>;
  readonly coveredCells: ReadonlySet<string>;
  readonly selectedMarkId: string | undefined;
  readonly onSelectMark: (mark: Mark) => void;
}

/**
 * One face of the container: photograph it, check the detected corners, and
 * mark damage on it. Marks are stored in metres on the face, so the same
 * marks appear on any later photo of this face.
 */
export function FacePanel(props: FacePanelProps) {
  const { handoverId, editable, face, container, photo } = props;
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [retaking, setRetaking] = useState(false);
  const [mode, setMode] = useState<OverlayMode>('view');
  const [draftCorners, setDraftCorners] = useState<Quad | null>(null);
  const [pendingRect, setPendingRect] = useState<FaceRect | null>(null);
  const [spoken, setSpoken] = useState<SpokenDamageResult | null>(null);
  const [spokenError, setSpokenError] = useState<unknown>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.handover(handoverId) });

  const upload = useMutation({
    mutationFn: async (file: Blob) => api.uploadPhoto(handoverId, face, await prepareUpload(file)),
    onSuccess: async (uploaded) => {
      setRetaking(false);
      setDraftCorners(null);
      setMode(uploaded.corners ? 'view' : 'corners');
      await refresh();
    },
  });

  const saveCorners = useMutation({
    mutationFn: (corners: Quad) => api.updateCorners(handoverId, photo?.id ?? '', corners),
    onSuccess: async () => {
      setMode('view');
      setDraftCorners(null);
      await refresh();
    },
  });

  const propose = useMutation({
    mutationFn: () => api.proposeDamage(handoverId, photo?.id ?? ''),
    onSuccess: refresh,
  });

  const addMark = useMutation({
    mutationFn: (input: Parameters<typeof api.addMark>[1]) => api.addMark(handoverId, input),
    onSuccess: async () => {
      setPendingRect(null);
      setMode('view');
      await refresh();
    },
  });

  if (!photo || retaking) {
    if (!editable) return null;
    return (
      <div className="stack">
        {upload.isPending ? (
          <Spinner label={t('handover.uploading')} />
        ) : (
          <CameraCapture
            guide={t('handover.photograph', { face: t(`face.${face}`) })}
            onCapture={(file) => upload.mutate(file)}
            renderOverlay={
              props.previousMarks.length > 0
                ? (video) => (
                    <LiveGhost
                      video={video}
                      handoverId={handoverId}
                      face={face}
                      dimensions={container.dimensions}
                      marks={props.previousMarks}
                    />
                  )
                : undefined
            }
          />
        )}
        {upload.isError && <ErrorNotice error={upload.error} onRetry={() => upload.reset()} />}
        {retaking && (
          <button type="button" className="link" onClick={() => setRetaking(false)}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    );
  }

  const editingCorners = mode === 'corners' && editable;
  const corners = editingCorners
    ? (draftCorners ?? photo.corners ?? defaultCorners(photo))
    : photo.corners;

  return (
    <div className="stack">
      {!photo.corners && editable && <p className="notice">{t('handover.cornersMissing')}</p>}
      {editingCorners && (
        <p className="muted">{t('handover.adjustHint', { face: t(`face.${face}`) })}</p>
      )}
      {mode === 'draw' && <p className="muted">{t('handover.addMarkHint')}</p>}

      <FaceOverlay
        photo={photo}
        face={face}
        dimensions={container.dimensions}
        corners={corners}
        marks={props.marks}
        previousMarks={props.previousMarks}
        resolvedPrevious={props.resolvedPrevious}
        coveredCells={props.coveredCells}
        mode={editable ? mode : 'view'}
        label={t(`faceTitle.${face}`)}
        selectedMarkId={props.selectedMarkId}
        onSelectMark={props.onSelectMark}
        onCornersChange={setDraftCorners}
        onDraw={setPendingRect}
      />
      {photo.redactedRegions > 0 && (
        <p className="muted">{t('handover.redacted', { count: photo.redactedRegions })}</p>
      )}

      {pendingRect && (
        <MarkForm
          locationCode={locationCode(face, pendingRect, container.dimensions)}
          busy={addMark.isPending}
          onCancel={() => setPendingRect(null)}
          onSubmit={(draft) =>
            addMark.mutate({
              face,
              rect: pendingRect,
              damageCode: draft.damageCode,
              componentCode: draft.componentCode,
              note: draft.note,
              status: 'new',
              source: 'confirmed',
              photoId: photo.id,
            })
          }
        />
      )}
      {propose.isPending && <Spinner label={t('handover.finding')} />}
      {propose.isSuccess && (
        <p className="notice">
          {propose.data.length > 0
            ? t('handover.found', { count: propose.data.length })
            : t('handover.noneFound')}
        </p>
      )}
      {spoken && (
        <div className="notice">
          <p>“{spoken.transcript}”</p>
          <p>
            {spoken.marks.length > 0
              ? t('handover.found', { count: spoken.marks.length })
              : t('handover.spokenNone')}
          </p>
          {spoken.unplaced.length > 0 && (
            <p className="muted">{t('handover.unplaced', { items: spoken.unplaced.join('; ') })}</p>
          )}
        </div>
      )}
      {spokenError !== null && <ErrorNotice error={spokenError} />}
      {(saveCorners.isError || addMark.isError || propose.isError) && (
        <ErrorNotice error={saveCorners.error ?? addMark.error ?? propose.error} />
      )}

      {editable && !pendingRect && (
        <div className="row wrap">
          {editingCorners ? (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMode('view');
                  setDraftCorners(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={saveCorners.isPending || !corners}
                onClick={() => corners && saveCorners.mutate(corners)}
              >
                {t('common.save')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="primary"
                disabled={!photo.corners || propose.isPending}
                onClick={() => propose.mutate()}
              >
                {t('handover.findDamage')}
              </button>
              <button
                type="button"
                className={mode === 'draw' ? 'primary' : 'secondary'}
                disabled={!photo.corners}
                onClick={() => setMode(mode === 'draw' ? 'view' : 'draw')}
              >
                {t('handover.addMark')}
              </button>
              <RecordButton
                label={t('handover.speakDamage')}
                working={t('handover.speaking')}
                process={(wav) => api.speakDamage(handoverId, face, wav)}
                onDone={async (result) => {
                  setSpoken(result);
                  setSpokenError(null);
                  await refresh();
                }}
                onError={(error) => {
                  setSpoken(null);
                  setSpokenError(error);
                }}
              />
              <button type="button" className="secondary" onClick={() => setMode('corners')}>
                {t('handover.adjust')}
              </button>
              <button type="button" className="secondary" onClick={() => setRetaking(true)}>
                {t('handover.retake')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
