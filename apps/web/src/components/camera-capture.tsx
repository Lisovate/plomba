import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';

interface CameraCaptureProps {
  /** What to frame, shown over the preview. */
  readonly guide: string;
  readonly onCapture: (photo: Blob) => void;
  readonly busy?: boolean;
  /** Drawn over the live preview, e.g. the previous handover's marks. */
  readonly renderOverlay?: (video: HTMLVideoElement) => ReactNode;
}

type CameraState = 'starting' | 'live' | 'unavailable';

/**
 * Live rear-camera preview with a shutter. Where the browser can't stream the
 * camera (permission denied, insecure origin, old browser) it falls back to the
 * phone's own camera app and the photo library.
 */
export function CameraCapture({
  guide,
  onCapture,
  busy = false,
  renderOverlay,
}: CameraCaptureProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('starting');

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    let stream: MediaStream | undefined;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
      })
      .then(async (granted) => {
        if (cancelled) {
          for (const track of granted.getTracks()) track.stop();
          return;
        }
        stream = granted;
        const video = videoRef.current;
        if (video) {
          video.srcObject = granted;
          await video.play().catch(() => undefined);
        }
        setState('live');
      })
      .catch(() => {
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const photo = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (photo) onCapture(photo);
  };

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onCapture(file);
  };

  return (
    <div className="camera">
      <div className="camera-view">
        <video ref={videoRef} playsInline muted hidden={state !== 'live'} />
        {state === 'live' && videoRef.current && renderOverlay?.(videoRef.current)}
        {state === 'starting' && <p className="camera-status">{t('camera.starting')}</p>}
        {state === 'unavailable' && <p className="camera-status">{t('camera.denied')}</p>}
        <p className="camera-guide">{guide}</p>
      </div>
      <div className="camera-actions">
        {state === 'live' ? (
          <button
            type="button"
            className="shutter"
            onClick={capture}
            disabled={busy}
            aria-label={t('camera.take')}
          />
        ) : (
          <label className="button">
            {t('camera.take')}
            <input type="file" accept="image/*" capture="environment" hidden onChange={choose} />
          </label>
        )}
        <label className="button secondary">
          {t('camera.choose')}
          <input type="file" accept="image/*" hidden onChange={choose} disabled={busy} />
        </label>
      </div>
    </div>
  );
}
