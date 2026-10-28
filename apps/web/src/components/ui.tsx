import { Fragment, type ReactNode, useSyncExternalStore } from 'react';
import { ApiError } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';

/** A container number as painted on the doors, `CSQU 305438 [3]`, with chosen characters highlighted. */
export function ContainerNumberText({
  value,
  changed = [],
}: {
  value: string;
  changed?: readonly number[];
}) {
  return (
    <span className="container-number">
      {[...value].map((char, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: characters are positional
        <Fragment key={index}>
          {(index === 4 || index === 10) && ' '}
          <span
            className={[
              changed.includes(index) ? 'changed' : '',
              index === 10 ? 'check-digit' : '',
            ].join(' ')}
          >
            {char}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const online = useOnline();
  let message = t('common.error');
  if (!online) message = t('common.offline');
  else if (error instanceof ApiError) message = error.problem?.title ?? error.message;
  return (
    <div className="notice error" role="alert">
      <p>{message}</p>
      {error instanceof ApiError &&
        error.problem?.issues?.map((issue) => (
          <p key={issue.path} className="muted">
            {issue.path}: {issue.message}
          </p>
        ))}
      {onRetry && (
        <button type="button" className="secondary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}
