import type {
  FaceView,
  HandoverDetail,
  IdentifyResult,
  Photo,
  SampleClip,
  VideoTracking,
} from '@plomba/contracts';
import {
  type CornerSplit,
  chooseWalkaroundPhotos,
  FACES,
  type Face,
  type FrameCandidate,
  harmonizeSides,
  type PhotoChoice,
  pickCandidateFrames,
  type Quad,
  usableSplit,
  viewAtFrame,
} from '@plomba/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Circle, CircleCheck, CirclePlay, Frame, ScanSearch, Sparkles, Upload } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { type FrameView, VideoAr } from '../components/video-ar.tsx';
import { useI18n } from '../i18n/index.tsx';
import { prepareUpload } from '../lib/image.ts';
import { BlankFramesError, frameTime, grabFrames, probeVideo } from '../lib/video-frames.ts';
import {
  addFrames,
  chosenVideoViews,
  type FrameSteps,
  type VideoStep,
} from '../lib/walkaround-upload.ts';

/** Frames sent to Muse Spark in one call; the server accepts up to 16. */
const MAX_FRAMES = 12;

interface Candidate extends FrameCandidate {
  readonly blob: Blob;
  readonly view: FaceView;
  /** Seen corner-on: the two faces' outlines, from SAM 3.1's mask. */
  readonly split: CornerSplit | null;
  /** Left or right was inferred without the doors in view: the checker should confirm it. */
  readonly guessedSide: boolean;
}

interface Analysis {
  readonly tracking: VideoTracking;
  readonly fps: number;
  /** The clip's size in pixels: the frames' and the tracked outlines' coordinates. */
  readonly size: { readonly width: number; readonly height: number };
  readonly candidates: readonly Candidate[];
  /** The photos proposed to the checker. */
  readonly choices: readonly PhotoChoice[];
  /** The door end's markings, read from the best door frame. */
  readonly doors: IdentifyResult | null;
}

type Part = PhotoChoice['part'];

/** Which part of which frame becomes the photo of which face. */
type Choices = ReadonlyMap<string, Face>;

const choiceKey = (index: number, part: Part) => `${index}:${part}`;

/** A quad in video pixels, in the pixels of the stored photo (which may be smaller). */
function scaleQuad([a, b, c, d]: Quad, k: number): Quad {
  const scale = (p: Quad[number]) => ({ x: p.x * k, y: p.y * k });
  return [scale(a), scale(b), scale(c), scale(d)];
}

function parseKey(key: string): { index: number; part: Part } {
  const [index, part] = key.split(':');
  return { index: Number(index), part: part as Part };
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
 * The clip can be kept as evidence. It plays back with the container's
 * coordinates and the last handover's damage drawn on it.
 */
export function WalkaroundScreen() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const detail = useQuery({ queryKey: queryKeys.handover(id), queryFn: () => api.handover(id) });
  const [clip, setClip] = useState<{ file: File; url: string; credit?: string } | null>(null);
  const samples = useQuery({ queryKey: queryKeys.samples, queryFn: api.samples });
  const sample = useMutation({
    mutationFn: (s: SampleClip) => api.sampleClip(s.url, `${s.title}.mp4`),
    onSuccess: (file, s) => start(file, s.credit),
  });
  const [step, setStep] = useState<Step>('tracking');
  const [use, setUse] = useState<Choices>(new Map());

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
      const size = { width, height };
      if (picked.length === 0) {
        return { tracking, fps, size, candidates: [], choices: [], doors: null };
      }
      const blobs = await grabFrames(
        chosen.url,
        picked.map((c) => frameTime(c.frame, fps)),
      );
      setStep('naming');
      const { views: named } = await api.videoFaces(blobs);
      const unnamed: FaceView = {
        face: null,
        squareOn: false,
        corner: null,
        doorEnd: null,
        clear: false,
        confidence: 0,
        note: '',
      };
      // One continuous view of a side is one side, whatever single frames say.
      const { views, guessed } = harmonizeSides(
        picked.map((c, i) => ({ frame: c.frame, view: named[i] ?? unnamed })),
        tracking.frames,
      );
      // A split whose near edge the frame cuts off would guess both faces' outlines.
      const splits = new Map(tracking.frames.map((f) => [f.frame, usableSplit(f.split, size)]));
      const candidates = picked.map((c, i) => {
        const blob = blobs[i] as Blob;
        const view = views[i] ?? unnamed;
        const split = splits.get(c.frame) ?? null;
        return { ...c, blob, view, split, guessedSide: guessed.has(i) };
      });
      const choices = chooseWalkaroundPhotos(candidates);
      const door = choices.find((c) => c.face === 'D');
      const doorFrame = door ? candidates[door.index] : undefined;
      setStep('reading');
      const doors = doorFrame ? await api.identify(doorFrame.blob).catch(() => null) : null;
      return { tracking, fps, size, candidates, choices, doors };
    },
  });
  // Callbacks given to mutate() fire only for the latest analysis, so a slow
  // earlier clip can't overwrite the choices for the current one.
  const run = (chosen: { file: File; url: string }) =>
    analyse.mutate(chosen, {
      onSuccess: ({ choices }) =>
        setUse(new Map(choices.map((c) => [choiceKey(c.index, c.part), c.face]))),
    });
  const analysis = analyse.data;

  // The clip is an object URL: release it with the screen or the next clip.
  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  // What is drawn on each frame: what the checker chose, else what Muse Spark saw.
  const viewAt = useCallback(
    (frame: number): FrameView | null => {
      if (!analysis) return null;
      const named = analysis.candidates.map((c, i) => ({
        frame: c.frame,
        view: frameView(c, i, use),
      }));
      return viewAtFrame(named, frame, Math.round(analysis.fps * 1.5));
    },
    [analysis, use],
  );

  const start = (file: File, credit?: string) => {
    analyse.reset();
    setUse(new Map());
    setClip({ file, url: URL.createObjectURL(file), ...(credit ? { credit } : {}) });
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) start(file);
  };

  if (detail.isPending) return <Spinner label={t('common.loading')} />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => detail.refetch()} />;
  const { container, handover } = detail.data;

  return (
    <div className="stack">
      <Card>
        <p className="eyebrow">{t('walk.title')}</p>
        <Link to={`/handovers/${id}`} className="big-number">
          <ContainerNumberText value={container.number} />
        </Link>
        <p className="muted">{t('walk.intro')}</p>
        <ol className="how">
          <li>
            <ScanSearch size={18} aria-hidden /> {t('walk.how.track')}
          </li>
          <li>
            <Frame size={18} aria-hidden /> {t('walk.how.pick')}
          </li>
          <li>
            <Sparkles size={18} aria-hidden /> {t('walk.how.name')}
          </li>
          <li>
            <CircleCheck size={18} aria-hidden /> {t('walk.how.confirm')}
          </li>
        </ol>
        <label className="dropzone">
          <Upload size={26} aria-hidden />
          <strong>{t('walk.video')}</strong>
          <span>{t('walk.tip')}</span>
          <input
            type="file"
            accept="video/mp4,video/quicktime"
            className="visually-hidden"
            onChange={choose}
          />
        </label>
      </Card>

      {samples.data && samples.data.length > 0 && (
        <section className="samples">
          <div className="section-head">
            <h2>{t('walk.samples')}</h2>
          </div>
          <ul className="sample-grid">
            {samples.data.map((s) => (
              <li key={s.url}>
                <button
                  type="button"
                  className="sample"
                  disabled={sample.isPending}
                  onClick={() => sample.mutate(s)}
                >
                  <CirclePlay size={26} aria-hidden />
                  <span>
                    <strong>{s.title}</strong>
                    <small>{s.credit}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {sample.isPending && <Spinner label={t('walk.loadingSample')} />}
          {sample.isError && <ErrorNotice error={sample.error} />}
        </section>
      )}

      {clip && (
        <VideoAr
          src={clip.url}
          tracking={analysis?.tracking}
          detail={detail.data}
          viewAt={viewAt}
        />
      )}
      {clip?.credit && (
        <p className="muted">
          {t('walk.sampleCredit')} {clip.credit}
        </p>
      )}

      {clip && analyse.isIdle && (
        <button type="button" className="primary large" onClick={() => run(clip)}>
          <Sparkles size={20} aria-hidden /> {t('walk.analyse')}
        </button>
      )}
      {analyse.isPending && <AnalysisSteps step={step} />}
      {analyse.isError &&
        (analyse.error instanceof BlankFramesError ? (
          <p className="notice error">{t('walk.blankFrames')}</p>
        ) : (
          <ErrorNotice error={analyse.error} onRetry={() => clip && run(clip)} />
        ))}

      {analysis && clip && (
        <Results
          key={clip.url}
          clip={clip.file}
          analysis={analysis}
          detail={detail.data}
          use={use}
          onUse={(key, face) =>
            setUse((current) => {
              const next = new Map(current);
              if (face) next.set(key, face);
              else next.delete(key);
              return next;
            })
          }
          editable={handover.status === 'open'}
        />
      )}
    </div>
  );
}

/** A candidate's faces for the overlay: the checker's choice, else Muse Spark's reading. */
function frameView(c: Candidate, index: number, use: Choices): FrameView | null {
  const whole = use.get(choiceKey(index, 'whole'));
  if (whole) return { face: whole };
  const left = use.get(choiceKey(index, 'left')) ?? c.view.corner?.left;
  const right = use.get(choiceKey(index, 'right')) ?? c.view.corner?.right;
  if (c.split && left && right) return { corner: { left, right } };
  // Any named face is drawn, even at an angle: the overlay is a guide, not a photo.
  return c.view.face ? { face: c.view.face } : null;
}

function Results({
  clip,
  analysis,
  detail,
  use,
  onUse,
  editable,
}: {
  clip: File;
  analysis: Analysis;
  detail: HandoverDetail;
  use: Choices;
  onUse: (key: string, face: Face | null) => void;
  editable: boolean;
}) {
  const { t } = useI18n();
  const { tracking, candidates, doors } = analysis;
  const named = new Set(
    candidates.flatMap((c) => [
      ...(c.view.squareOn && c.view.face ? [c.view.face] : []),
      ...(c.split && c.view.corner ? [c.view.corner.left, c.view.corner.right] : []),
    ]),
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
              const parts: Part[] = c.split && c.view.corner ? ['left', 'right'] : ['whole'];
              const used = parts.some((part) => use.has(choiceKey(i, part)));
              return (
                <li key={c.frame} className={used ? 'frame used' : 'frame'}>
                  <Thumbnail blob={c.blob} alt={t('walk.frameAlt', { frame: c.frame + 1 })} />
                  <p className="frame-label">
                    {c.view.corner && c.split
                      ? `${t(`faceTitle.${c.view.corner.left}`)} | ${t(`faceTitle.${c.view.corner.right}`)}`
                      : c.view.face
                        ? t(`faceTitle.${c.view.face}`)
                        : t('walk.noFace')}
                    {c.view.face && !c.view.squareOn && ` · ${t('walk.angled')}`}
                    {(c.view.face || c.view.corner) && !c.view.clear && ` · ${t('walk.unclear')}`}
                    {(c.view.face || c.view.corner) && ` · ${Math.round(c.view.confidence * 100)}%`}
                  </p>
                  <p className="muted frame-note">{c.view.note}</p>
                  {c.guessedSide && <p className="hint">{t('walk.sideGuessed')}</p>}
                  {editable &&
                    parts.map((part) => (
                      <label key={part} className="field compact">
                        {t(`walk.useAs.${part}`)}
                        <select
                          value={use.get(choiceKey(i, part)) ?? ''}
                          onChange={(e) =>
                            onUse(choiceKey(i, part), (e.target.value || null) as Face | null)
                          }
                        >
                          <option value="">{t('walk.notUsed')}</option>
                          {FACES.map((f) => (
                            <option key={f} value={f}>
                              {t(`faceTitle.${f}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {editable && use.size > 0 && (
        <AddToHandover handoverId={detail.handover.id} clip={clip} analysis={analysis} use={use} />
      )}
    </>
  );
}

const STEPS: readonly Step[] = ['tracking', 'choosing', 'naming', 'reading'];

/** Where the analysis is: done, current and still to come. */
function AnalysisSteps({ step }: { step: Step }) {
  const { t } = useI18n();
  const current = STEPS.indexOf(step);
  return (
    <ol className="stepper card" role="status" aria-live="polite">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'current' : ''}>
          {i < current ? (
            <CircleCheck size={18} aria-hidden />
          ) : i === current ? (
            <span className="spinner-dot" aria-hidden />
          ) : (
            <Circle size={18} aria-hidden />
          )}
          {t(`walk.step.${s}`)}
        </li>
      ))}
    </ol>
  );
}

/** A frame grabbed from the clip; its object URL lives as long as the image. */
function Thumbnail({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url ? <img src={url} alt={alt} /> : null;
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
  clip,
  analysis,
  use,
}: {
  handoverId: string;
  clip: File;
  analysis: Analysis;
  use: Choices;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [findDamage, setFindDamage] = useState(true);
  const instance = useQuery({ queryKey: queryKeys.instance, queryFn: api.instance });
  const videoEvidence = instance.data?.videoEvidence === true;
  const [keepVideo, setKeepVideo] = useState(true);
  const videoStep = useRef<VideoStep>({ uploaded: false });
  const [progress, setProgress] = useState('');
  // How far each chosen frame got, kept across retries (see addFrames).
  const steps = useRef<FrameSteps>(new Map());
  const chosen = useMemo(
    () =>
      [...use]
        .map(([key, face]) => {
          const { index, part } = parseKey(key);
          return { key, face, part, index, candidate: analysis.candidates[index] };
        })
        .filter(
          (c): c is { key: string; face: Face; part: Part; index: number; candidate: Candidate } =>
            c.candidate !== undefined,
        )
        .sort((a, b) => FACES.indexOf(a.face) - FACES.indexOf(b.face)),
    [use, analysis],
  );

  const add = useMutation({
    mutationFn: () =>
      addFrames(
        handoverId,
        chosen.map(({ key, face, part, candidate }) => ({
          key,
          face,
          image: () => prepareUpload(candidate.blob),
          // One face of a corner view: its outline comes from the split, not from the whole container.
          outline: (photo: Photo) => {
            const quad = part === 'whole' ? null : candidate.split?.[part];
            return quad ? scaleQuad(quad, photo.width / analysis.size.width) : null;
          },
        })),
        {
          api,
          steps: steps.current,
          findDamage,
          video:
            videoEvidence && keepVideo
              ? {
                  data: clip,
                  views: chosenVideoViews(analysis.candidates, chosen),
                  step: videoStep.current,
                }
              : undefined,
          onVideoProgress: () => setProgress(t('walk.keepingVideo')),
          onProgress: (stage, index, frame) => {
            const face = t(`faceTitle.${frame.face}`);
            setProgress(
              stage === 'upload'
                ? t('walk.adding', { n: index + 1, total: chosen.length, face })
                : t('walk.lookingForDamage', { face }),
            );
          },
        },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.handover(handoverId) }),
    onSuccess: () => navigate(`/handovers/${handoverId}`),
  });

  return (
    <Card>
      {videoEvidence && (
        <label className="check">
          <input
            type="checkbox"
            checked={keepVideo}
            disabled={add.isPending || videoStep.current.uploaded}
            onChange={(e) => setKeepVideo(e.target.checked)}
          />
          {t('walk.keepVideo')}
        </label>
      )}
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
