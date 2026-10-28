import type { IdentifyResult } from '@plomba/contracts';
import { normaliseContainerNumber, parseContainerNumber, parseSizeType } from '@plomba/core';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { CameraCapture } from '../components/camera-capture.tsx';
import { Card, ContainerNumberText, ErrorNotice, Spinner } from '../components/ui.tsx';
import { type Translate, useI18n } from '../i18n/index.tsx';
import { prepareUpload } from '../lib/image.ts';

/** What the identify step hands to the container screen. */
export interface IdentifyHandoff {
  readonly sealNumbers: readonly string[];
}

const COMMON_SIZE_TYPES = ['22G1', '42G1', '45G1', 'L5G1', '22R1', '45R1', '22U1', '22T6'];

export function IdentifyScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const identify = useMutation({
    mutationFn: async (photo: Blob) => api.identify(await prepareUpload(photo, 1600)),
  });

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const onCapture = (photo: Blob) => {
    setPreview(URL.createObjectURL(photo));
    identify.mutate(photo);
  };

  const retake = () => {
    identify.reset();
    setPreview(null);
    setManual(false);
  };

  const confirmed = (number: string, seals: readonly string[]) => {
    const handoff: IdentifyHandoff = { sealNumbers: seals };
    navigate(`/containers/${number}`, { state: handoff });
  };

  return (
    <div className="stack">
      <h1>{t('identify.title')}</h1>
      {!preview && !manual && (
        <>
          <CameraCapture guide={t('identify.guide')} onCapture={onCapture} />
          <button type="button" className="link" onClick={() => setManual(true)}>
            {t('identify.manual')}
          </button>
        </>
      )}
      {preview && <img src={preview} alt="" className="preview" />}
      {identify.isPending && (
        <Card>
          <Spinner label={t('identify.reading')} />
          <p className="muted">{t('identify.checking')}</p>
        </Card>
      )}
      {identify.isError && <ErrorNotice error={identify.error} onRetry={retake} />}
      {(identify.isSuccess || manual) && (
        <ConfirmContainer
          key={identify.data ? 'read' : 'manual'}
          result={identify.data}
          onRetake={retake}
          onConfirmed={confirmed}
        />
      )}
    </div>
  );
}

function verdictText(t: Translate, result: IdentifyResult): string {
  switch (result.verdict) {
    case 'verified':
      return t('identify.verified');
    case 'corrected':
      return t('identify.corrected');
    case 'ambiguous':
      return t('identify.ambiguous');
    case 'unreadable':
      return t('identify.unreadable');
  }
}

function ConfirmContainer({
  result,
  onRetake,
  onConfirmed,
}: {
  result: IdentifyResult | undefined;
  onRetake: () => void;
  onConfirmed: (number: string, seals: readonly string[]) => void;
}) {
  const { t } = useI18n();
  const [number, setNumber] = useState(
    result?.containerNumber ?? result?.read.containerNumber ?? '',
  );
  const [sizeType, setSizeType] = useState(result?.read.sizeTypeCode ?? '');
  const parsed = parseContainerNumber(number);
  const knownSizeType = parseSizeType(sizeType);
  const changed =
    result?.candidates.find((c) => c.containerNumber === normaliseContainerNumber(number))
      ?.changedPositions ?? [];

  const register = useMutation({
    mutationFn: () =>
      api.registerContainer({
        number,
        sizeTypeCode: knownSizeType ? knownSizeType.code : null,
      }),
    onSuccess: (container) => onConfirmed(container.number, result?.read.sealNumbers ?? []),
  });

  return (
    <Card className={result ? `verdict-${result.verdict}` : ''}>
      {result && (
        <>
          <h2>{verdictText(t, result)}</h2>
          <p className="muted">{result.explanation}</p>
          {/* A model's pick between valid numbers is advice, so the alternatives stay visible. */}
          {result.candidates.length > 1 && (
            <div className="choices">
              {result.candidates.map((c) => (
                <button
                  type="button"
                  key={c.containerNumber}
                  className={
                    c.containerNumber === normaliseContainerNumber(number)
                      ? 'choice selected'
                      : 'choice'
                  }
                  onClick={() => setNumber(c.containerNumber)}
                >
                  <ContainerNumberText value={c.containerNumber} changed={c.changedPositions} />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {parsed.ok && (
        <p className="big-number">
          <ContainerNumberText value={parsed.value.value} changed={changed} />
        </p>
      )}
      {changed.length > 0 && <p className="muted">{t('identify.highlight')}</p>}

      <label className="field">
        {t('identify.number')}
        <input
          value={number}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setNumber(e.target.value.toUpperCase())}
        />
        <span className={parsed.ok ? 'hint ok' : 'hint'}>
          {parsed.ok
            ? t('identify.numberValid')
            : parsed.error.code === 'check-digit-mismatch'
              ? t('identify.numberExpected', { digit: parsed.error.expected })
              : t('identify.numberIncomplete')}
        </span>
      </label>

      <label className="field">
        {t('identify.sizeType')}
        <input
          value={sizeType}
          list="size-types"
          autoCapitalize="characters"
          onChange={(e) => setSizeType(e.target.value.toUpperCase())}
        />
        <datalist id="size-types">
          {COMMON_SIZE_TYPES.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
        {!knownSizeType && <span className="hint">{t('identify.sizeTypeUnknown')}</span>}
      </label>

      {result && result.read.sealNumbers.length > 0 && (
        <p>
          {t('identify.seals')}: {result.read.sealNumbers.join(', ')}
        </p>
      )}
      {result && result.read.hazardClasses.length > 0 && (
        <p>
          {t('identify.hazards')}: {result.read.hazardClasses.join(', ')}
        </p>
      )}

      {register.isError && <ErrorNotice error={register.error} />}
      <div className="row">
        <button type="button" className="secondary" onClick={onRetake}>
          {t('identify.retake')}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!parsed.ok || register.isPending}
          onClick={() => register.mutate()}
        >
          {t('identify.confirm')}
        </button>
      </div>
    </Card>
  );
}
