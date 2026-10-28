import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { useI18n } from '../i18n/index.tsx';
import { NoteRecorder } from '../lib/audio.ts';

/** Tap to dictate, tap again to stop; the transcript is handed to `onText`. */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const { t } = useI18n();
  const recorder = useRef<NoteRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [denied, setDenied] = useState(false);

  // Stopping, converting and transcribing are one step, so the button shows
  // progress from the moment the checker stops talking.
  const transcribe = useMutation({
    mutationFn: async (active: NoteRecorder) => api.transcribe(await active.stop()),
    onSuccess: ({ text }) => {
      if (text) onText(text);
    },
  });

  useEffect(() => () => recorder.current?.cancel(), []);

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null;

  const toggle = async () => {
    if (recording && recorder.current) {
      setRecording(false);
      transcribe.mutate(recorder.current);
      recorder.current = null;
      return;
    }
    try {
      recorder.current = new NoteRecorder();
      await recorder.current.start();
      setDenied(false);
      setRecording(true);
    } catch {
      recorder.current = null;
      setDenied(true);
    }
  };

  return (
    <div className="dictate">
      <button
        type="button"
        className={recording ? 'primary recording' : 'secondary'}
        disabled={transcribe.isPending}
        onClick={toggle}
        aria-pressed={recording}
      >
        {transcribe.isPending
          ? t('dictate.working')
          : recording
            ? t('dictate.stop')
            : t('dictate.start')}
      </button>
      {denied && <span className="hint">{t('dictate.denied')}</span>}
      {transcribe.isError && <span className="hint">{t('common.error')}</span>}
    </div>
  );
}
