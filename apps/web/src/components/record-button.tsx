import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { NoteRecorder } from '../lib/audio.ts';

interface RecordButtonProps<T> {
  /** The button's label while idle. */
  readonly label: string;
  /** Shown while the recording is being processed. */
  readonly working: string;
  /** What happens to the recording (mono WAV), e.g. transcription. */
  readonly process: (wav: Blob) => Promise<T>;
  readonly onDone: (result: T) => void;
  readonly onError?: (error: unknown) => void;
  readonly disabled?: boolean;
}

/**
 * Tap to record, tap again to stop. Stopping, converting and processing are
 * one step, so the button shows progress from the moment the checker stops
 * talking. Hidden where the browser can't record.
 */
export function RecordButton<T>({
  label,
  working,
  process,
  onDone,
  onError,
  disabled = false,
}: RecordButtonProps<T>) {
  const { t } = useI18n();
  const recorder = useRef<NoteRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [denied, setDenied] = useState(false);

  const run = useMutation({
    mutationFn: async (active: NoteRecorder) => process(await active.stop()),
    onSuccess: onDone,
    onError,
  });

  useEffect(() => () => recorder.current?.cancel(), []);

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null;

  const toggle = async () => {
    if (recording && recorder.current) {
      setRecording(false);
      run.mutate(recorder.current);
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
        disabled={disabled || run.isPending}
        onClick={toggle}
        aria-pressed={recording}
      >
        {run.isPending ? working : recording ? t('dictate.stop') : label}
      </button>
      {denied && <span className="hint">{t('dictate.denied')}</span>}
      {run.isError && !onError && <span className="hint">{t('common.error')}</span>}
    </div>
  );
}
