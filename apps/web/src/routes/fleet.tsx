import type { ContainerSummary } from '@plomba/contracts';
import { useQuery } from '@tanstack/react-query';
import { Box, ChevronRight, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

/** An owner code typed on its own (PLB, PLBU) is looked up on the server; anything else filters the list. */
const OWNER_CODE = /^[A-Z]{3}[UJZ]?$/;

/**
 * The containers this installation has recorded, most recently handed over
 * first: the fleet view of an owner, a lessor or a terminal.
 */
export function FleetScreen() {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toUpperCase().replace(/\s+/g, ''));
  const owner = OWNER_CODE.test(search) ? search : '';
  const list = useQuery({
    queryKey: queryKeys.containers(owner),
    queryFn: () => api.containers(owner || undefined),
  });
  const shown = (list.data ?? []).filter((c) => !search || c.number.includes(search));

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">{t('fleet.eyebrow')}</p>
        <h1>{t('fleet.title')}</h1>
        <p className="muted">{t('fleet.intro')}</p>
      </div>
      <label className="search">
        <Search size={18} aria-hidden />
        <input
          type="search"
          value={query}
          placeholder={t('fleet.search')}
          aria-label={t('fleet.search')}
          autoCapitalize="characters"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {list.isPending && <Spinner label={t('common.loading')} />}
      {list.isError && <ErrorNotice error={list.error} onRetry={() => list.refetch()} />}
      {list.isSuccess && shown.length === 0 && (
        <div className="empty">
          <Box size={28} aria-hidden />
          <p>{search ? t('fleet.noMatch') : t('fleet.none')}</p>
        </div>
      )}
      <ul className="list">
        {shown.map((c) => (
          <li key={c.number}>
            <ContainerRow container={c} language={language} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContainerRow({ container, language }: { container: ContainerSummary; language: string }) {
  const { t } = useI18n();
  const last = container.lastHandover;
  return (
    <Link to={`/containers/${container.number}`} className="list-item entity">
      <span className={`entity-icon ${last?.status === 'open' ? 'open' : ''}`}>
        <Box size={22} aria-hidden />
      </span>
      <span className="entity-main">
        <ContainerNumberText value={container.number} />
        <span className="entity-meta">
          <span>{container.sizeTypeCode ?? '—'}</span>
          <span>
            {t('fleet.handovers', {
              count: container.handoverCount,
              sealed: container.sealedCount,
            })}
          </span>
          {last && (
            <span>
              {t(last.direction === 'in' ? 'handover.in' : 'handover.out')} · {last.place} ·{' '}
              {new Date(last.startedAt).toLocaleDateString(language, { dateStyle: 'medium' })}
            </span>
          )}
        </span>
      </span>
      <ChevronRight className="entity-end" size={20} aria-hidden />
    </Link>
  );
}
