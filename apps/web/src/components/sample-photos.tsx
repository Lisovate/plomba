import type { Sample } from '@plomba/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { useState } from 'react';
import { api, queryKeys } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { ErrorNotice, Spinner } from './ui.tsx';

/** Samples enter through the same callback as a photo from the camera or library. */
export function SamplePhotos({
  use,
  onChoose,
  compact = false,
  busy = false,
}: {
  use: NonNullable<Sample['use']>;
  onChoose: (file: File, sample: Sample) => void | Promise<void>;
  compact?: boolean;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(!compact);
  const samples = useQuery({ queryKey: queryKeys.samples, queryFn: api.samples });
  const choose = useMutation({
    mutationFn: async (sample: Sample) => onChoose(await api.sampleFile(sample), sample),
  });
  const photos =
    samples.data?.filter((sample) => sample.kind === 'photo' && sample.use === use) ?? [];
  if (samples.isError)
    return <ErrorNotice error={samples.error} onRetry={() => samples.refetch()} />;
  if (photos.length === 0) return null;
  return (
    <section className="sample-photos stack">
      {compact ? (
        <button
          type="button"
          className="secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ImagePlus size={18} aria-hidden /> {t('samples.usePhoto')}
        </button>
      ) : (
        <h2>{t('samples.doors')}</h2>
      )}
      {expanded && (
        <ul className="sample-grid">
          {photos.map((sample, index) => (
            <li key={sample.url}>
              <button
                type="button"
                className="sample"
                disabled={busy || choose.isPending}
                onClick={() => choose.mutate(sample)}
              >
                <img src={sample.url} alt="" loading="lazy" />
                <span>
                  <strong>
                    {use === 'doors'
                      ? t('samples.doorPhoto', { n: index + 1, total: photos.length })
                      : sample.title}
                  </strong>
                  <small>{sample.credit}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {choose.isPending && <Spinner label={t('samples.loadingPhoto')} />}
      {choose.isError && <ErrorNotice error={choose.error} />}
    </section>
  );
}
