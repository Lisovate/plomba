import type { Sample } from '@plomba/contracts';
import { viewAtFrame } from '@plomba/core';
import { useQuery } from '@tanstack/react-query';
import { CirclePlay, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { Card, ErrorNotice, Spinner } from '../components/ui.tsx';
import { VideoAr, type VideoArLayers } from '../components/video-ar.tsx';
import { useI18n } from '../i18n/index.tsx';
import { firstRecordedLabel, openDamageInView } from '../lib/passport-ar.ts';
import { analyseVideo, candidateView, type VideoAnalysisStep } from '../lib/video-analysis.ts';
import { BlankFramesError } from '../lib/video-frames.ts';

export function TryScreen() {
  const { t } = useI18n();
  const samples = useQuery({ queryKey: queryKeys.samples, queryFn: api.samples });
  const [selected, setSelected] = useState<Sample | null>(null);
  const clips = samples.data?.filter((sample) => sample.kind === 'clip') ?? [];
  return (
    <div className="stack">
      <Card>
        <p className="eyebrow">{t('try.eyebrow')}</p>
        <h1>{t('try.title')}</h1>
        <p className="muted">{t('try.intro')}</p>
        <Link to="/identify" className="button secondary">
          <ScanLine size={18} aria-hidden /> {t('try.handover')}
        </Link>
      </Card>
      {samples.isPending && <Spinner label={t('common.loading')} />}
      {samples.isError && <ErrorNotice error={samples.error} onRetry={() => samples.refetch()} />}
      {samples.isSuccess && clips.length === 0 && <p className="notice">{t('try.noSamples')}</p>}
      <ul className="sample-grid">
        {clips.map((sample) => (
          <li key={sample.url}>
            <button
              type="button"
              className="sample"
              aria-pressed={selected?.url === sample.url}
              onClick={() => setSelected(sample)}
            >
              <CirclePlay size={26} aria-hidden />
              <span>
                <strong>{sample.title}</strong>
                <small>{sample.credit}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <SamplePlayer key={selected.url} sample={selected} />}
    </div>
  );
}

function SamplePlayer({ sample }: { sample: Sample }) {
  const { t, language } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [step, setStep] = useState<VideoAnalysisStep>('tracking');
  const [layers, setLayers] = useState<VideoArLayers>({
    outlineGrid: true,
    damage: true,
    information: true,
  });
  const download = useQuery({
    queryKey: ['sample-file', sample.url],
    queryFn: () => api.sampleFile(sample),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  useEffect(() => {
    if (!download.data) return;
    // As in a walk-around, a local URL lets Safari seek without HTTP range requests.
    const created = URL.createObjectURL(download.data);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [download.data]);
  const analysis = useQuery({
    queryKey: ['sample-analysis', sample.url],
    queryFn: async () => analyseVideo({ file: download.data as File, url: url as string }, setStep),
    enabled: url !== null && download.isSuccess,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const number = sample.containerNumber;
  const history = useQuery({
    queryKey: queryKeys.container(number ?? ''),
    queryFn: () => api.containerHistory(number ?? ''),
    enabled: number !== null,
  });
  const data = analysis.data;
  const viewAt = useCallback(
    (frame: number) =>
      data
        ? viewAtFrame(
            data.candidates.map((candidate) => ({
              frame: candidate.frame,
              view: candidateView(candidate),
            })),
            frame,
            Math.round(data.fps * 1.5),
          )
        : null,
    [data],
  );
  const damage = history.data ? openDamageInView(history.data, ['D', 'R', 'F', 'L', 'T']) : [];

  return (
    <section ref={ref} className="stack sample-player" aria-label={sample.title}>
      <h2>{sample.title}</h2>
      {url && (
        <VideoAr
          src={url}
          tracking={data?.tracking}
          passport={history.data}
          viewAt={viewAt}
          layers={layers}
          autoPlay
        />
      )}
      <fieldset className="layer-toggles">
        <legend>{t('try.layers')}</legend>
        {(['outlineGrid', 'damage', 'information'] as const).map((layer) => (
          <label className="check" key={layer}>
            <input
              type="checkbox"
              checked={layers[layer]}
              disabled={layer !== 'outlineGrid' && !history.data}
              onChange={(event) =>
                setLayers((current) => ({ ...current, [layer]: event.target.checked }))
              }
            />
            {t(`try.layer.${layer}`)}
          </label>
        ))}
      </fieldset>
      <p className="muted sample-caption">
        {t('walk.sampleCredit')} {sample.credit}{' '}
        {sample.sourceUrl && (
          <a href={sample.sourceUrl} target="_blank" rel="noreferrer">
            {t('samples.source')}
          </a>
        )}
      </p>
      {download.isPending && <Spinner label={t('walk.loadingSample')} />}
      {download.isError && (
        <ErrorNotice error={download.error} onRetry={() => download.refetch()} />
      )}
      {analysis.isFetching && <Spinner label={t(`walk.step.${step}`)} />}
      {analysis.isError &&
        (analysis.error instanceof BlankFramesError ? (
          <p className="notice error">{t('walk.blankFrames')}</p>
        ) : (
          <ErrorNotice error={analysis.error} onRetry={() => analysis.refetch()} />
        ))}
      {data && data.candidates.length === 0 && <p className="notice">{t('walk.noFrames')}</p>}
      {!number && <p className="muted">{t('try.noContainer')}</p>}
      {number && history.isPending && <Spinner label={t('try.loadingHistory')} />}
      {history.isError && <ErrorNotice error={history.error} onRetry={() => history.refetch()} />}
      {history.data && !history.data.chain.ok && (
        <p className="notice error">{t('passport.broken')}</p>
      )}
      {history.data?.chain.ok && layers.damage && (
        <details className="card">
          <summary>{t('try.openDamage', { count: damage.length })}</summary>
          <ul className="list">
            {damage.map((item) => (
              <li className="list-item" key={item.id}>
                <span>
                  {t(`faceTitle.${item.face}`)} ·{' '}
                  <code>
                    {item.locationCode} {item.damageCode}
                  </code>
                </span>
                <span className="muted">
                  {firstRecordedLabel(item, history.data.handovers, t, language)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
