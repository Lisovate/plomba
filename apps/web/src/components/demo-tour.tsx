import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, queryKeys } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { DEMO_TOUR } from '../lib/demo-tour.ts';
import { Card } from './ui.tsx';

export function DemoTour() {
  const { t } = useI18n();
  const samples = useQuery({ queryKey: queryKeys.samples, queryFn: api.samples });
  const demo = (samples.data?.length ?? 0) > 0;
  const containers = useQuery({
    queryKey: queryKeys.containers(''),
    queryFn: () => api.containers(),
    enabled: demo,
  });
  if (!demo) return null;

  return (
    <Card>
      <h2>{t('home.tour.title')}</h2>
      <ul className="list">
        <li>
          <Link to="/try" className="list-item">
            {t('home.tour.ar')}
          </Link>
        </li>
        {DEMO_TOUR.filter((stop) => containers.data?.some((c) => c.number === stop.number)).map(
          (stop) =>
            stop.target === 'open' ? (
              <OpenHandoverStop key={stop.number} number={stop.number} label={stop.label} />
            ) : (
              <li key={stop.number}>
                <Link to={`/containers/${stop.number}`} className="list-item">
                  {t(stop.label)}
                </Link>
              </li>
            ),
        )}
        <li>
          <a href="/api/openapi.json" className="list-item">
            {t('home.tour.api')}
          </a>
        </li>
      </ul>
    </Card>
  );
}

function OpenHandoverStop({
  number,
  label,
}: {
  number: string;
  label: (typeof DEMO_TOUR)[number]['label'];
}) {
  const { t } = useI18n();
  const history = useQuery({
    queryKey: queryKeys.container(number),
    queryFn: () => api.containerHistory(number),
  });
  const open = history.data?.handovers.find((h) => h.status === 'open');
  if (!open) return null;
  return (
    <li>
      <Link to={`/handovers/${open.id}`} className="list-item">
        {t(label)}
      </Link>
    </li>
  );
}
