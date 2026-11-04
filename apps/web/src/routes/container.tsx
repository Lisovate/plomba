import type { ContainerHistory, Direction, TransportMode } from '@plomba/contracts';
import { formatWagonNumber, parseWagonNumber } from '@plomba/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Plus, Ruler, ShieldAlert, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { ContainerPassport } from '../components/container-passport.tsx';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { useProfile } from '../lib/profile.ts';
import type { IdentifyHandoff } from './identify.tsx';

export function ContainerScreen() {
  const { number = '' } = useParams();
  const { t, language } = useI18n();
  const history = useQuery({
    queryKey: queryKeys.container(number),
    queryFn: () => api.containerHistory(number),
  });

  if (history.isPending) return <Spinner label={t('common.loading')} />;
  if (history.isError)
    return <ErrorNotice error={history.error} onRetry={() => history.refetch()} />;

  const { container, handovers, chain, damage } = history.data;
  const open = handovers.find((h) => h.status === 'open');
  const { length, width, height } = container.dimensions;

  return (
    <div className="stack">
      <Card>
        <p className="eyebrow">{t('container.eyebrow')}</p>
        <p className="big-number">
          <ContainerNumberText value={container.number} />
        </p>
        <ul className="meta">
          <li>
            <Box size={15} aria-hidden /> {container.sizeTypeCode ?? '—'}
          </li>
          <li>
            <Ruler size={15} aria-hidden />
            {t('container.dimensions', {
              length: length.toFixed(2),
              width: width.toFixed(2),
              height: height.toFixed(2),
            })}
          </li>
        </ul>
        <ChainBadge chain={chain} />
      </Card>

      {open ? (
        <Link to={`/handovers/${open.id}`} className="button primary large">
          {t('container.continue')}
        </Link>
      ) : (
        <StartHandover containerNumber={container.number} expanded={handovers.length === 0} />
      )}

      <ContainerPassport
        container={container}
        handovers={handovers}
        damage={damage}
        chainOk={chain.ok}
      />

      {handovers.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('container.history')}</h2>
            <span>{handovers.length}</span>
          </div>
          <ul className="timeline">
            {handovers.map((h) => (
              <li key={h.id} className={h.status === 'open' ? 'open' : 'sealed'}>
                <Link to={`/handovers/${h.id}`} className="list-item">
                  <span className="cluster">
                    <strong>
                      {t(h.direction === 'in' ? 'handover.in' : 'handover.out')} · {h.place}
                    </strong>
                    <span className={`pill ${h.status === 'open' ? 'open' : 'ok'}`}>
                      {t(h.status === 'open' ? 'handover.open' : 'handover.closed')}
                    </span>
                  </span>
                  <span className="muted">
                    {new Date(h.startedAt).toLocaleString(language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    · {h.checker}
                  </span>
                  {h.seal && (
                    <code className="hash">
                      #{h.seal.sequence + 1} · SHA-256 {h.seal.hash.slice(0, 16)}…
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
      <p className="pill danger">
        <ShieldAlert size={14} aria-hidden />
        {t('container.chainBroken', { index: (chain.brokenAt ?? 0) + 1 })}
      </p>
    );
  }
  return (
    <p className={chain.length > 0 ? 'pill ok' : 'pill'}>
      <ShieldCheck size={14} aria-hidden />
      {chain.length > 0
        ? t('container.chainOk', { count: chain.length })
        : t('container.chainEmpty')}
    </p>
  );
}

/**
 * Someone reading a container's history gets the history first: the form opens
 * on a tap, and straight away when the checker has just read the doors or the
 * container has no handovers yet.
 */
function StartHandover({
  containerNumber,
  expanded,
}: {
  containerNumber: string;
  expanded: boolean;
}) {
  const { t } = useI18n();
  const fromIdentify = useLocation().state !== null;
  const [open, setOpen] = useState(expanded || fromIdentify);
  if (open) return <StartHandoverForm containerNumber={containerNumber} />;
  return (
    <button type="button" className="secondary large" onClick={() => setOpen(true)}>
      <Plus size={18} aria-hidden /> {t('container.start')}
    </button>
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
  const [transportMode, setTransportMode] = useState<TransportMode | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  const wagon = transportMode === 'rail' && vehicleId.trim() ? parseWagonNumber(vehicleId) : null;

  const start = useMutation({
    mutationFn: () =>
      api.startHandover({
        containerNumber,
        direction,
        place,
        checker,
        ...(handedOverBy.trim() ? { handedOverBy } : {}),
        ...(receivedBy.trim() ? { receivedBy } : {}),
        ...(transportMode ? { transportMode } : {}),
        ...(transportMode && vehicleId.trim() ? { vehicleId } : {}),
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
        <fieldset className="segmented">
          <legend>{t('start.transport')}</legend>
          {(['road', 'rail'] as const).map((mode) => (
            <label key={mode} className={transportMode === mode ? 'selected' : ''}>
              <input
                type="radio"
                name="transport"
                value={mode}
                checked={transportMode === mode}
                onChange={() => setTransportMode(mode)}
              />
              {t(mode === 'road' ? 'start.road' : 'start.rail')}
            </label>
          ))}
        </fieldset>
        {transportMode && (
          <label className="field">
            {t(transportMode === 'road' ? 'start.truck' : 'start.wagon')}
            <input
              value={vehicleId}
              inputMode={transportMode === 'rail' ? 'numeric' : 'text'}
              autoCapitalize="characters"
              onChange={(e) => setVehicleId(e.target.value)}
            />
            {wagon && (
              <span className={wagon.ok ? 'hint ok' : 'hint'}>
                {wagon.ok
                  ? `${formatWagonNumber(wagon.value)} · ${t('start.wagonValid')}`
                  : wagon.expected === undefined
                    ? t('start.wagonDigits')
                    : t('start.wagonExpected', { digit: wagon.expected })}
              </span>
            )}
          </label>
        )}
        {start.isError && <ErrorNotice error={start.error} />}
        <button
          type="submit"
          className="primary large"
          disabled={start.isPending || (wagon !== null && !wagon.ok)}
        >
          {t('start.submit')}
        </button>
      </form>
    </Card>
  );
}
