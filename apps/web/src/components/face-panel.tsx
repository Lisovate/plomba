import type { Container, Mark, Photo } from '@plomba/contracts';
import { type Face, type FaceRect, locationCode, type Quad } from '@plomba/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { prepareUpload } from '../lib/image.ts';
import { CameraCapture } from './camera-capture.tsx';
import { defaultCorners, FaceOverlay, type OverlayMode } from './face-overlay.tsx';
import { MarkForm } from './mark-form.tsx';
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
      {(saveCorners.isError || addMark.isError) && (
        <ErrorNotice error={saveCorners.error ?? addMark.error} />
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
                className={mode === 'draw' ? 'primary' : 'secondary'}
                disabled={!photo.corners}
                onClick={() => setMode(mode === 'draw' ? 'view' : 'draw')}
              >
                {t('handover.addMark')}
              </button>
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
