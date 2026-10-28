import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api, queryKeys } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { Card, ErrorNotice, Spinner } from './ui.tsx';

/** Shows the app once the server is satisfied; asks for the access code if it asks for one. */
export function AccessGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: api.session,
    staleTime: 60_000,
  });

  if (session.isPending) return <Spinner label={t('common.loading')} />;
  if (session.isError)
    return <ErrorNotice error={session.error} onRetry={() => session.refetch()} />;
  if (session.data.required && !session.data.authenticated) return <AccessCodeForm />;
  return children;
}

function AccessCodeForm() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const login = useMutation({
    mutationFn: () => api.login(code),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <Card>
      <form className="stack" onSubmit={submit}>
        <h1>{t('access.title')}</h1>
        <p className="muted">{t('access.hint')}</p>
        <label className="field">
          {t('access.code')}
          <input
            type="password"
            autoComplete="current-password"
            value={code}
            required
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        {login.isError && <ErrorNotice error={login.error} />}
        <button type="submit" className="primary large" disabled={login.isPending || !code}>
          {t('access.submit')}
        </button>
      </form>
    </Card>
  );
}
