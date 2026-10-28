import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Link, Outlet, useRouteError } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError, queryKeys } from './api/client.ts';
import { AccessGate } from './components/access-gate.tsx';
import { ErrorNotice, useOnline } from './components/ui.tsx';
import { I18nProvider, useI18n } from './i18n/index.tsx';
import { ContainerScreen } from './routes/container.tsx';
import { HandoverScreen } from './routes/handover.tsx';
import { HomeScreen } from './routes/home.tsx';
import { IdentifyScreen } from './routes/identify.tsx';
import { ReportScreen } from './routes/report.tsx';
import { SimulateScreen } from './routes/simulate.tsx';

/** A 401 means the session ended: ask the server again, which brings back the access-code form. */
function onError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.session });
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status < 500) && failures < 1,
    },
    mutations: { retry: 0 },
  },
});

function Shell() {
  const { t, language, setLanguage } = useI18n();
  const online = useOnline();
  return (
    <>
      <header className="app-header no-print">
        <Link to="/" className="brand">
          <img src="/icons/favicon.svg" alt="" width={28} height={28} />
          Plomba
        </Link>
        <button
          type="button"
          className="link"
          onClick={() => setLanguage(language === 'en' ? 'pl' : 'en')}
        >
          {t('app.language')}
        </button>
      </header>
      {!online && <p className="offline-banner no-print">{t('common.offline')}</p>}
      <main>
        <AccessGate>
          <Outlet />
        </AccessGate>
      </main>
    </>
  );
}

function RouteError() {
  return <ErrorNotice error={useRouteError()} />;
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'identify', element: <IdentifyScreen /> },
      { path: 'containers/:number', element: <ContainerScreen /> },
      { path: 'handovers/:id', element: <HandoverScreen /> },
      { path: 'handovers/:id/report', element: <ReportScreen /> },
      { path: 'simulate', element: <SimulateScreen /> },
    ],
  },
]);

export function App() {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  );
}
