import type { ContainerHistory, Direction } from '@plomba/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { useProfile } from '../lib/profile.ts';
import type { IdentifyHandoff } from './identify.tsx';

export function ContainerScreen() {
  const { number = '' } = useParams();
  const { t } = useI18n();
  const history = useQuery({
    queryKey: queryKeys.container(number),
    queryFn: () => api.containerHistory(number),
  });

  if (history.isPending) return <Spinner label={t('common.loading')} />;
  if (history.isError)
    return <ErrorNotice error={history.error} onRetry={() => history.refetch()} />;

  const { container, handovers, chain } = history.data;
  const open = handovers.find((h) => h.status === 'open');
  const { length, width, height } = container.dimensions;

  return (
    <div className="stack">
      <Card>
        <p className="big-number">
          <ContainerNumberText value={container.number} />
        </p>
        <p className="muted">
          {container.sizeTypeCode ?? '—'} ·{' '}
          {t('container.dimensions', {
            length: length.toFixed(2),
            width: width.toFixed(2),
            height: height.toFixed(2),
          })}
        </p>
        <ChainBadge chain={chain} />
      </Card>

      {open ? (
        <Link to={`/handovers/${open.id}`} className="button primary large">
          {t('container.continue')}
        </Link>
      ) : (
        <StartHandoverForm containerNumber={container.number} />
      )}

      {handovers.length > 0 && (
        <section>
          <h2>{t('container.history')}</h2>
          <ul className="list">
            {handovers.map((h) => (
              <li key={h.id}>
                <Link to={`/handovers/${h.id}`} className="list-item">
                  <span>
                    {t(h.direction === 'in' ? 'handover.in' : 'handover.out')} · {h.place}
                  </span>
                  <span className="muted">
                    {new Date(h.startedAt).toLocaleString()} · {h.checker} ·{' '}
                    {t(h.status === 'open' ? 'handover.open' : 'handover.closed')}
                  </span>
                  {h.seal && (
                    <code className="hash">
                      #{h.seal.sequence + 1} {h.seal.hash.slice(0, 16)}…
                    </code>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ChainBadge({ chain }: { chain: ContainerHistory['chain'] }) {
  const { t } = useI18n();
  if (!chain.ok) {
    return (
      <p className="badge danger">
        {t('container.chainBroken', { index: (chain.brokenAt ?? 0) + 1 })}
      </p>
    );
  }
  return (
    <p className={chain.length > 0 ? 'badge ok' : 'badge'}>
      {chain.length > 0
        ? t('container.chainOk', { count: chain.length })
        : t('container.chainEmpty')}
    </p>
  );
}

function StartHandoverForm({ containerNumber }: { containerNumber: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const handoff = useLocation().state as IdentifyHandoff | null;
  const [profile] = useProfile();
  const [direction, setDirection] = useState<Direction>('in');
  const [place, setPlace] = useState(profile.place);
  const [checker, setChecker] = useState(profile.checker);
  const [handedOverBy, setHandedOverBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [seals, setSeals] = useState(handoff?.sealNumbers.join(', ') ?? '');

  const start = useMutation({
    mutationFn: () =>
      api.startHandover({
        containerNumber,
        direction,
        place,
        checker,
        ...(handedOverBy.trim() ? { handedOverBy } : {}),
        ...(receivedBy.trim() ? { receivedBy } : {}),
        sealNumbers: seals
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: (handover) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recent });
      void queryClient.invalidateQueries({ queryKey: queryKeys.container(containerNumber) });
      navigate(`/handovers/${handover.id}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start.mutate();
  };

  return (
    <Card>
      <h2>{t('container.start')}</h2>
      <form onSubmit={submit} className="stack">
        <fieldset className="segmented">
          <legend>{t('start.direction')}</legend>
          {(['in', 'out'] as const).map((d) => (
            <label key={d} className={direction === d ? 'selected' : ''}>
              <input
                type="radio"
                name="direction"
                value={d}
                checked={direction === d}
                onChange={() => setDirection(d)}
              />
              {t(d === 'in' ? 'start.in' : 'start.out')}
            </label>
          ))}
        </fieldset>
        <label className="field">
          {t('start.place')}
          <input value={place} required onChange={(e) => setPlace(e.target.value)} />
        </label>
        <label className="field">
          {t('start.checker')}
          <input value={checker} required onChange={(e) => setChecker(e.target.value)} />
        </label>
        <label className="field">
          {t('start.handedOverBy')}
          <input value={handedOverBy} onChange={(e) => setHandedOverBy(e.target.value)} />
        </label>
        <label className="field">
          {t('start.receivedBy')}
          <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
        </label>
        <label className="field">
          {t('start.seals')}
          <input value={seals} onChange={(e) => setSeals(e.target.value)} />
        </label>
        {start.isError && <ErrorNotice error={start.error} />}
        <button type="submit" className="primary large" disabled={start.isPending}>
          {t('start.submit')}
        </button>
      </form>
    </Card>
  );
}
