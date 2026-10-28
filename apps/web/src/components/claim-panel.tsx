import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { Card, ErrorNotice, Spinner } from './ui.tsx';

/**
 * Drafts a claim for the damage that is new since the previous handover. The
 * server only returns a draft whose items and evidence match the sealed
 * records; the checks are listed with it.
 */
export function ClaimPanel({ handoverId }: { handoverId: string }) {
  const { t, language } = useI18n();
  const [copied, setCopied] = useState(false);
  const draft = useMutation({ mutationFn: () => api.draftClaim(handoverId, language) });

  return (
    <Card className="claim">
      <h2>{t('claim.title')}</h2>
      {draft.isIdle && (
        <button type="button" className="primary no-print" onClick={() => draft.mutate()}>
          {t('claim.draft')}
        </button>
      )}
      {draft.isPending && <Spinner label={t('claim.drafting')} />}
      {draft.isError && <ErrorNotice error={draft.error} onRetry={() => draft.mutate()} />}
      {draft.data?.status === 'no-new-damage' && <p>{draft.data.explanation}</p>}
      {draft.data?.status === 'drafted' && (
        <>
          <p>
            <strong>{t('claim.to')}:</strong> {draft.data.claim.addressee}
            <br />
            <strong>{t('claim.subject')}:</strong> {draft.data.claim.subject}
          </p>
          <pre className="letter">{draft.data.claim.letter}</pre>
          <section className="checks">
            <h3>{t('claim.verified')}</h3>
            <ul>
              {draft.data.verification.checks.map((check) => (
                <li key={check}>✓ {t(`claim.check.${check}`)}</li>
              ))}
            </ul>
            <p className="muted">
              {t('claim.attempts', {
                count: draft.data.verification.attempts,
                tools: draft.data.verification.toolCalls.join(', '),
              })}
            </p>
          </section>
          <button
            type="button"
            className="secondary no-print"
            onClick={async () => {
              if (draft.data?.status !== 'drafted') return;
              await navigator.clipboard.writeText(draft.data.claim.letter);
              setCopied(true);
            }}
          >
            {copied ? t('claim.copied') : t('claim.copy')}
          </button>
        </>
      )}
    </Card>
  );
}
