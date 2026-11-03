import type { FaceView, HandoverDetail, IdentifyResult, VideoTracking } from '@plomba/contracts';
import {
  bestFramePerFace,
  FACES,
  type Face,
  type FrameCandidate,
  faceAtFrame,
  pickCandidateFrames,
} from '@plomba/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { VideoAr } from '../components/video-ar.tsx';
import { useI18n } from '../i18n/index.tsx';
import { prepareUpload } from '../lib/image.ts';
import { frameTime, grabFrames, probeVideo } from '../lib/video-frames.ts';

/** Frames sent to Muse Spark in one call; the server accepts up to 16. */
const MAX_FRAMES = 12;

interface Candidate extends FrameCandidate {
  readonly blob: Blob;
  readonly url: string;
  readonly view: FaceView;
}

interface Analysis {
  readonly tracking: VideoTracking;
  readonly fps: number;
  readonly candidates: readonly Candidate[];
  /** The door end's markings, read from the best door frame. */
  readonly doors: IdentifyResult | null;
}

type Step = 'tracking' | 'choosing' | 'naming' | 'reading';

/**
 * A recorded walk-around (a phone or Meta AI glasses) turned into the
 * handover's face photos:
 * 1. SAM 3.1 tracks the container through every frame;
 * 2. the frames where one face is whole, large and square-on are cut out;
 * 3. Muse Spark names the face in each, and reads the doors;
 * 4. the checker confirms, and the frames go through the same pipeline as
 *    photos (registration, blurring, coverage, damage proposals).
 * The clip itself is never stored. It also plays back with the container's
 * coordinates and the last handover's damage drawn on it.
 */
export function WalkaroundScreen() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const detail = useQuery({ queryKey: queryKeys.handover(id), queryFn: () => api.handover(id) });
  const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  const [step, setStep] = useState<Step>('tracking');
  const [use, setUse] = useState<ReadonlyMap<number, Face>>(new Map());

  const analyse = useMutation({
    mutationFn: async (chosen: { file: File; url: string }): Promise<Analysis> => {
      setStep('tracking');
      const tracking = await api.trackVideo(chosen.file);
      const { width, height, duration } = await probeVideo(chosen.url);
      const fps = tracking.frameCount / (duration || 1);
      setStep('choosing');
      const picked = pickCandidateFrames(
        tracking.frames,
        { width, height },
        { minGap: Math.max(1, Math.round(fps)), max: MAX_FRAMES },
      );
      if (picked.length === 0) return { tracking, fps, candidates: [], doors: null };
      const blobs = await grabFrames(
        chosen.url,
        picked.map((c) => frameTime(c.frame, fps)),
      );
      setStep('naming');
      const { views } = await api.videoFaces(blobs);
      const candidates = picked.map((c, i) => {
        const blob = blobs[i] as Blob;
        const view = views[i] ?? {
          face: null,
          squareOn: false,
          clear: false,
          confidence: 0,
          note: '',
        };
        return { ...c, blob, url: URL.createObjectURL(blob), view };
      });
      const door = bestFramePerFace(picked, views).get('D');
      const doorFrame = candidates.find((c) => c.frame === door?.frame);
      setStep('reading');
      const doors = doorFrame ? await api.identify(doorFrame.blob).catch(() => null) : null;
      return { tracking, fps, candidates, doors };
    },
    onSuccess: ({ candidates }) => {
      const best = bestFramePerFace(
        candidates,
        candidates.map((c) => c.view),
      );
      setUse(
        new Map(
          [...best].map(([face, c]) => [candidates.findIndex((x) => x.frame === c.frame), face]),
        ),
      );
    },
  });
  const analysis = analyse.data;

  // Thumbnails and the clip are object URLs: release them with the screen.
  useEffect(
    () => () => {
      for (const c of analysis?.candidates ?? []) URL.revokeObjectURL(c.url);
    },
    [analysis],
  );
  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  // The face drawn on each frame: what the checker assigned, else what Muse Spark saw square-on.
  const faceAt = useCallback(
    (frame: number): Face | null => {
      if (!analysis) return null;
      const named = analysis.candidates.map((c, i) => ({
        frame: c.frame,
        face: use.get(i) ?? (c.view.squareOn ? c.view.face : null),
      }));
      return faceAtFrame(named, frame, Math.round(analysis.fps * 1.5));
    },
    [analysis, use],
  );

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    analyse.reset();
    setUse(new Map());
    setClip({ file, url: URL.createObjectURL(file) });
  };

  if (detail.isPending) return <Spinner label={t('common.loading')} />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => detail.refetch()} />;
  const { container, handover } = detail.data;

  return (
    <div className="stack">
      <Card>
        <h1>{t('walk.title')}</h1>
        <Link to={`/handovers/${id}`} className="big-number">
          <ContainerNumberText value={container.number} />
        </Link>
        <p className="muted">{t('walk.intro')}</p>
        <label className="field">
          {t('walk.video')}
          <input type="file" accept="video/mp4,video/quicktime" onChange={choose} />
        </label>
        <p className="muted">{t('walk.tip')}</p>
      </Card>

      {clip && (
        <VideoAr
          src={clip.url}
          tracking={analysis?.tracking}
          detail={detail.data}
          faceAt={faceAt}
        />
      )}

      {clip && analyse.isIdle && (
        <button type="button" className="primary large" onClick={() => analyse.mutate(clip)}>
          {t('walk.analyse')}
        </button>
      )}
      {analyse.isPending && <Spinner label={t(`walk.step.${step}`)} />}
      {analyse.isError && (
        <ErrorNotice error={analyse.error} onRetry={() => clip && analyse.mutate(clip)} />
      )}

      {analysis && (
        <Results
          analysis={analysis}
          detail={detail.data}
          use={use}
          onUse={(index, face) =>
            setUse((current) => {
              const next = new Map(current);
              if (face) next.set(index, face);
              else next.delete(index);
              return next;
            })
          }
          editable={handover.status === 'open'}
        />
      )}
    </div>
  );
}

function Results({
  analysis,
  detail,
  use,
  onUse,
  editable,
}: {
  analysis: Analysis;
  detail: HandoverDetail;
  use: ReadonlyMap<number, Face>;
  onUse: (index: number, face: Face | null) => void;
  editable: boolean;
}) {
  const { t } = useI18n();
  const { tracking, candidates, doors } = analysis;
  const named = new Set(
    candidates.flatMap((c) => (c.view.squareOn && c.view.face ? [c.view.face] : [])),
  );

  return (
    <>
      <p className="muted">
        {t('walk.summary', {
          tracked: tracking.frames.length,
          total: tracking.frameCount,
          candidates: candidates.length,
          faces: named.size,
        })}
        {tracking.cached && ` · ${t('walk.cached')}`}
      </p>
      {candidates.length === 0 && <p className="notice">{t('walk.noFrames')}</p>}
      <DoorsCheck doors={doors} expected={detail.container.number} />

      {candidates.length > 0 && (
        <section>
          <h2>{t('walk.frames')}</h2>
          <ul className="filmstrip">
            {candidates.map((c, i) => {
              const face = use.get(i);
              return (
                <li key={c.frame} className={face ? 'frame used' : 'frame'}>
                  <img src={c.url} alt={t('walk.frameAlt', { frame: c.frame + 1 })} />
                  <p className="frame-label">
                    {c.view.face ? t(`faceTitle.${c.view.face}`) : t('walk.noFace')}
                    {c.view.face && !c.view.squareOn && ` · ${t('walk.angled')}`}
                    {c.view.face && !c.view.clear && ` · ${t('walk.unclear')}`}
                    {c.view.face && ` · ${Math.round(c.view.confidence * 100)}%`}
                  </p>
                  <p className="muted frame-note">{c.view.note}</p>
                  {editable && (
                    <label className="field compact">
                      {t('walk.useAs')}
                      <select
                        value={face ?? ''}
                        onChange={(e) => onUse(i, (e.target.value || null) as Face | null)}
                      >
                        <option value="">{t('walk.notUsed')}</option>
                        {FACES.map((f) => (
                          <option key={f} value={f}>
                            {t(`faceTitle.${f}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {editable && use.size > 0 && (
        <AddToHandover handoverId={detail.handover.id} analysis={analysis} use={use} />
      )}
    </>
  );
}

function DoorsCheck({ doors, expected }: { doors: IdentifyResult | null; expected: string }) {
  const { t } = useI18n();
  if (!doors) return null;
  if (doors.verdict !== 'verified' || !doors.containerNumber) {
    return <p className="notice">{t('walk.doorsUnverified')}</p>;
  }
  const matches = doors.containerNumber === expected;
  return (
    <p className={matches ? 'notice ok' : 'notice error'}>
      {t(matches ? 'walk.doorsMatch' : 'walk.doorsMismatch')}{' '}
      <ContainerNumberText value={doors.containerNumber} />
    </p>
  );
}

function AddToHandover({
  handoverId,
  analysis,
  use,
}: {
  handoverId: string;
  analysis: Analysis;
  use: ReadonlyMap<number, Face>;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [findDamage, setFindDamage] = useState(true);
  const [progress, setProgress] = useState('');
  const chosen = useMemo(
    () =>
      [...use]
        .map(([index, face]) => ({ face, candidate: analysis.candidates[index] }))
        .filter((c): c is { face: Face; candidate: Candidate } => c.candidate !== undefined)
        .sort((a, b) => FACES.indexOf(a.face) - FACES.indexOf(b.face)),
    [use, analysis],
  );

  const add = useMutation({
    mutationFn: async () => {
      for (const [i, { face, candidate }] of chosen.entries()) {
        const faceName = t(`faceTitle.${face}`);
        setProgress(t('walk.adding', { n: i + 1, total: chosen.length, face: faceName }));
        const photo = await api.uploadPhoto(handoverId, face, await prepareUpload(candidate.blob));
        if (findDamage && photo.corners) {
          setProgress(t('walk.lookingForDamage', { face: faceName }));
          await api.proposeDamage(handoverId, photo.id);
        }
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.handover(handoverId) }),
    onSuccess: () => navigate(`/handovers/${handoverId}`),
  });

  return (
    <Card>
      <label className="check">
        <input
          type="checkbox"
          checked={findDamage}
          onChange={(e) => setFindDamage(e.target.checked)}
        />
        {t('walk.findDamage')}
      </label>
      <button
        type="button"
        className="primary large"
        disabled={add.isPending}
        onClick={() => add.mutate()}
      >
        {t('walk.add', { count: chosen.length })}
      </button>
      {add.isPending && <Spinner label={progress} />}
      {add.isError && <ErrorNotice error={add.error} />}
    </Card>
  );
}
