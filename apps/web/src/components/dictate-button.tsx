import { Mic } from 'lucide-react';
import { api } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { RecordButton } from './record-button.tsx';

/** Tap to dictate, tap again to stop; the transcript is handed to `onText`. */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const { t } = useI18n();
  return (
    <RecordButton
      label={t('dictate.start')}
      icon={<Mic size={18} aria-hidden />}
      working={t('dictate.working')}
      process={api.transcribe}
      onDone={({ text }) => {
        if (text) onText(text);
      }}
    />
  );
}
