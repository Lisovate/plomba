import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Link, Outlet, useRouteError } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ErrorNotice, useOnline } from './components/ui.tsx';
import { I18nProvider, useI18n } from './i18n/index.tsx';
import { ContainerScreen } from './routes/container.tsx';
import { HandoverScreen } from './routes/handover.tsx';
import { HomeScreen } from './routes/home.tsx';
import { IdentifyScreen } from './routes/identify.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
    mutations: { retry: 0 },
  },
});

function Shell() {
  const { t, language, setLanguage } = useI18n();
  const online = useOnline();
  return (
    <>
      <header className="app-header">
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
      {!online && <p className="offline-banner">{t('common.offline')}</p>}
      <main>
        <Outlet />
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
