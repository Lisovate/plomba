import type { HandoverSummary } from '@plomba/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { useInstallPrompt } from '../lib/install.ts';
import { isComplete, useProfile } from '../lib/profile.ts';

export function HomeScreen() {
  const { t } = useI18n();
  const [profile, saveProfile] = useProfile();
  const install = useInstallPrompt();
  const recent = useQuery({ queryKey: queryKeys.recent, queryFn: api.recentHandovers });
  const ready = isComplete(profile);

  const open = recent.data?.filter((h) => h.status === 'open') ?? [];
  const sealed = recent.data?.filter((h) => h.status === 'closed') ?? [];

  return (
    <div className="stack">
      <Card>
        <h2>{t('profile.title')}</h2>
        <label className="field">
          {t('profile.name')}
          <input
            value={profile.checker}
            autoComplete="name"
            onChange={(e) => saveProfile({ ...profile, checker: e.target.value })}
          />
        </label>
        <label className="field">
          {t('profile.place')}
          <input
            value={profile.place}
            onChange={(e) => saveProfile({ ...profile, place: e.target.value })}
          />
        </label>
        {!ready && <p className="muted">{t('profile.missing')}</p>}
      </Card>

      {ready ? (
        <Link to="/identify" className="button primary large">
          {t('home.inspect')}
        </Link>
      ) : (
        <button type="button" className="primary large" disabled>
          {t('home.inspect')}
        </button>
      )}

      {install.kind === 'prompt' && (
        <button type="button" className="secondary" onClick={install.prompt}>
          {t('home.install')}
        </button>
      )}
      {install.kind === 'ios' && <p className="notice">{t('home.installIos')}</p>}

      {recent.isPending && <Spinner label={t('common.loading')} />}
      {recent.isError && <ErrorNotice error={recent.error} onRetry={() => recent.refetch()} />}
      {recent.isSuccess && recent.data.length === 0 && <p className="muted">{t('home.none')}</p>}
      {open.length > 0 && <HandoverList title={t('home.open')} handovers={open} />}
      {sealed.length > 0 && <HandoverList title={t('home.recent')} handovers={sealed} />}
    </div>
  );
}

function HandoverList({ title, handovers }: { title: string; handovers: HandoverSummary[] }) {
  const { t, language } = useI18n();
  return (
    <section>
      <h2>{title}</h2>
      <ul className="list">
        {handovers.map((h) => (
          <li key={h.id}>
            <Link to={`/handovers/${h.id}`} className="list-item">
              <ContainerNumberText value={h.containerNumber} />
              <span className="muted">
                {t(h.direction === 'in' ? 'handover.in' : 'handover.out')} · {h.place} ·{' '}
                {new Date(h.startedAt).toLocaleString(language)}
              </span>
              <span className="muted">
                {t('home.photos', { count: h.photoCount })} ·{' '}
                {t('home.marks', { count: h.markCount })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
