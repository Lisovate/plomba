import { FACES, type Face } from '@plomba/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { Card, ErrorNotice, Spinner } from '../components/ui.tsx';
import { VideoAr } from '../components/video-ar.tsx';
import { useI18n } from '../i18n/index.tsx';
import { prepareUpload } from '../lib/image.ts';

/**
 * A desktop simulation of the walk-around: a recorded clip stands in for the
 * camera, and SAM 3.1's video tracking places the container's coordinates on
 * every frame.
 */
export function SimulateScreen() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const recent = useQuery({ queryKey: queryKeys.recent, queryFn: api.recentHandovers });
  const [handoverId, setHandoverId] = useState('');
  const [face, setFace] = useState<Face>('R');
  const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);

  const selected = handoverId || recent.data?.[0]?.id || '';
  const detail = useQuery({
    queryKey: queryKeys.handover(selected),
    queryFn: () => api.handover(selected),
    enabled: selected !== '',
  });
  const track = useMutation({ mutationFn: (file: File) => api.trackVideo(file) });
  const capture = useMutation({
    mutationFn: async () => {
      const element = video.current;
      if (!element) throw new Error('No video');
      const canvas = document.createElement('canvas');
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      canvas.getContext('2d')?.drawImage(element, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.92),
      );
      if (!blob) throw new Error('Could not capture the frame');
      return api.uploadPhoto(selected, face, await prepareUpload(blob));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.handover(selected) }),
  });

  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    track.reset();
    setClip({ file, url: URL.createObjectURL(file) });
  };

  return (
    <div className="stack">
      <h1>{t('sim.title')}</h1>
      <p className="notice">{t('sim.intro')}</p>
      <Card>
        <label className="field">
          {t('sim.handover')}
          <select value={selected} onChange={(e) => setHandoverId(e.target.value)}>
            {recent.data?.map((h) => (
              <option key={h.id} value={h.id}>
                {h.containerNumber} · {t(h.direction === 'in' ? 'handover.in' : 'handover.out')} ·{' '}
                {h.place} · {t(h.status === 'open' ? 'handover.open' : 'handover.closed')}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="segmented">
          <legend>{t('sim.face')}</legend>
          {FACES.map((f) => (
            <label key={f} className={face === f ? 'selected' : ''}>
              <input type="radio" name="face" checked={face === f} onChange={() => setFace(f)} />
              {t(`faceTitle.${f}`)}
            </label>
          ))}
        </fieldset>
        <label className="field">
          {t('sim.video')}
          <input type="file" accept="video/mp4,video/quicktime" onChange={choose} />
        </label>
      </Card>

      {clip && detail.data && (
        <>
          <VideoAr
            src={clip.url}
            tracking={track.data}
            detail={detail.data}
            face={face}
            onVideo={(element) => {
              video.current = element;
            }}
          />
          {track.isIdle && (
            <button type="button" className="primary large" onClick={() => track.mutate(clip.file)}>
              {t('sim.track')}
            </button>
          )}
          {track.isPending && <Spinner label={t('sim.tracking')} />}
          {track.isError && (
            <ErrorNotice error={track.error} onRetry={() => track.mutate(clip.file)} />
          )}
          {track.data && (
            <p className="muted">
              {t('sim.tracked', { frames: track.data.frames.length, total: track.data.frameCount })}
              {track.data.cached && ` · ${t('sim.cached')}`}
            </p>
          )}
          {detail.data.handover.status === 'open' && (
            <div className="row wrap">
              <button
                type="button"
                className="secondary"
                disabled={capture.isPending}
                onClick={() => capture.mutate()}
              >
                {t('sim.capture', { face: t(`face.${face}`) })}
              </button>
              <Link to={`/handovers/${selected}`} className="button secondary">
                {t('sim.open')}
              </Link>
            </div>
          )}
          {capture.isPending && <Spinner label={t('handover.uploading')} />}
          {capture.isSuccess && <p className="notice">{t('sim.captured')}</p>}
          {capture.isError && <ErrorNotice error={capture.error} />}
        </>
      )}
      {detail.isError && <ErrorNotice error={detail.error} />}
    </div>
  );
}
