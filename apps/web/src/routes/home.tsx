import type { HandoverSummary } from '@plomba/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Camera,
  ChevronRight,
  CirclePlay,
  ClipboardList,
  Download,
  MapPin,
  ScanLine,
  ShieldCheck,
  TrainFront,
  Truck,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { DemoTour } from '../components/demo-tour.tsx';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { useInstallPrompt } from '../lib/install.ts';
import { isComplete, type Profile, useProfile } from '../lib/profile.ts';
import { vehicleLabel } from '../lib/transport.ts';

export function HomeScreen() {
  const { t } = useI18n();
  const [profile, saveProfile] = useProfile();
  const install = useInstallPrompt();
  const recent = useQuery({ queryKey: queryKeys.recent, queryFn: api.recentHandovers });
  const ready = isComplete(profile);
  const [firstVisit] = useState(() => !isComplete(profile));
  const [editing, setEditing] = useState(false);

  const open = recent.data?.filter((h) => h.status === 'open') ?? [];
  const sealed = recent.data?.filter((h) => h.status === 'closed') ?? [];
  const today = new Date().toDateString();
  const sealedToday = sealed.filter(
    (h) => h.closedAt && new Date(h.closedAt).toDateString() === today,
  ).length;
  const marksOpen = open.reduce((sum, h) => sum + h.markCount, 0);

  return (
    <div className="stack">
      <section className="hero-action">
        <h1>{t('home.heroTitle')}</h1>
        <p>{t('home.heroText')}</p>
        <Link to="/identify" className="button accent large">
          <ScanLine size={20} aria-hidden /> {t('home.inspect')}
        </Link>
      </section>

      <DemoTour />

      {editing ? (
        <ProfileForm profile={profile} onChange={saveProfile} onDone={() => setEditing(false)} />
      ) : ready ? (
        <div className="hello">
          <div>
            <p className="eyebrow">{t('home.greeting')}</p>
            <h2>{profile.checker}</h2>
            <p className="profile-line">
              <span>
                <MapPin size={16} aria-hidden /> {profile.place}
              </span>
            </p>
          </div>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('profile.change')}
          </button>
        </div>
      ) : (
        <Card>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            <UserRound size={18} aria-hidden /> {t('profile.title')}
          </button>
        </Card>
      )}

      {recent.isSuccess && recent.data.length > 0 && (
        <div className="stats">
          <div className="stat">
            <strong>{open.length}</strong>
            <span>{t('home.statOpen')}</span>
          </div>
          <div className="stat">
            <strong>{sealedToday}</strong>
            <span>{t('home.statSealedToday')}</span>
          </div>
          <div className="stat">
            <strong>{marksOpen}</strong>
            <span>{t('home.statMarks')}</span>
          </div>
        </div>
      )}

      <Link to="/try" className="button secondary">
        <CirclePlay size={20} aria-hidden /> {t('home.try')}
      </Link>

      {firstVisit && (
        <Card className="intro">
          <p className="eyebrow">{t('intro.eyebrow')}</p>
          <h2>{t('app.tagline')}</h2>
          <ol className="steps">
            <li>{t('intro.identify')}</li>
            <li>{t('intro.record')}</li>
            <li>{t('intro.confirm')}</li>
            <li>{t('intro.seal')}</li>
          </ol>
        </Card>
      )}

      {install.kind === 'prompt' && (
        <button type="button" className="secondary" onClick={install.prompt}>
          <Download size={18} aria-hidden /> {t('home.install')}
        </button>
      )}
      {install.kind === 'ios' && <p className="notice">{t('home.installIos')}</p>}

      {recent.isPending && <Spinner label={t('common.loading')} />}
      {recent.isError && <ErrorNotice error={recent.error} onRetry={() => recent.refetch()} />}
      {recent.isSuccess && recent.data.length === 0 && (
        <div className="empty">
          <ClipboardList size={28} aria-hidden />
          <p>{t('home.none')}</p>
        </div>
      )}
      {open.length > 0 && <HandoverList title={t('home.open')} handovers={open} />}
      {sealed.length > 0 && <HandoverList title={t('home.recent')} handovers={sealed} />}
    </div>
  );
}

function ProfileForm({
  profile,
  onChange,
  onDone,
}: {
  profile: Profile;
  onChange: (profile: Profile) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <h2>
        <UserRound size={20} aria-hidden /> {t('profile.title')}
      </h2>
      <label className="field">
        {t('profile.name')}
        <input
          value={profile.checker}
          autoComplete="name"
          onChange={(e) => onChange({ ...profile, checker: e.target.value })}
        />
      </label>
      <label className="field">
        {t('profile.place')}
        <input
          value={profile.place}
          onChange={(e) => onChange({ ...profile, place: e.target.value })}
        />
      </label>
      <p className="muted">{t('profile.optional')}</p>
      <button type="button" className="secondary" onClick={onDone}>
        {t('common.done')}
      </button>
    </Card>
  );
}

function HandoverList({ title, handovers }: { title: string; handovers: HandoverSummary[] }) {
  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="muted">{handovers.length}</span>
      </div>
      <ul className="list">
        {handovers.map((h) => (
          <li key={h.id}>
            <HandoverRow handover={h} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One handover as a tappable row: the container, where and how it moved, and what's recorded. */
function HandoverRow({ handover: h }: { handover: HandoverSummary }) {
  const { t, language } = useI18n();
  const open = h.status === 'open';
  return (
    <Link to={`/handovers/${h.id}`} className="list-item entity">
      <span className={`entity-icon ${open ? 'open' : 'sealed'}`}>
        {open ? <Camera size={22} aria-hidden /> : <ShieldCheck size={22} aria-hidden />}
      </span>
      <span className="entity-main">
        <span className="cluster">
          <ContainerNumberText value={h.containerNumber} />
          <span className={`pill ${h.direction}`}>
            {h.direction === 'in' ? (
              <ArrowDownToLine size={13} aria-hidden />
            ) : (
              <ArrowUpFromLine size={13} aria-hidden />
            )}
            {t(h.direction === 'in' ? 'handover.in' : 'handover.out')}
          </span>
        </span>
        <span className="entity-meta">
          <span>
            <MapPin size={14} aria-hidden /> {h.place}
          </span>
          {h.vehicleId && (
            <span>
              {h.transportMode === 'rail' ? (
                <TrainFront size={14} aria-hidden />
              ) : (
                <Truck size={14} aria-hidden />
              )}
              {vehicleLabel(h)}
            </span>
          )}
          <span>
            {new Date(h.startedAt).toLocaleString(language, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          <span>
            {t('home.photos', { count: h.photoCount })} · {t('home.marks', { count: h.markCount })}
          </span>
        </span>
      </span>
      <ChevronRight className="entity-end" size={20} aria-hidden />
    </Link>
  );
}
