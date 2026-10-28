import type { ComponentCode, DamageCode } from '@plomba/core';
import { COMPONENT_CODES, DAMAGE_CODES } from '@plomba/core';
import { type FormEvent, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { DictateButton } from './dictate-button.tsx';

/** The damage types a checker reaches for most; the rest are in the full list. */
const QUICK_DAMAGE: readonly DamageCode[] = ['DT', 'HO', 'BT', 'CU', 'CO', 'BR', 'MS', 'CK'];

export interface MarkDraft {
  readonly damageCode: DamageCode;
  readonly componentCode: ComponentCode | null;
  readonly note: string | null;
}

export function MarkForm({
  locationCode,
  busy,
  onSubmit,
  onCancel,
}: {
  locationCode: string;
  busy: boolean;
  onSubmit: (draft: MarkDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [damageCode, setDamageCode] = useState<DamageCode>('DT');
  const [componentCode, setComponentCode] = useState<ComponentCode | ''>('PAA');
  const [note, setNote] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      damageCode,
      componentCode: componentCode || null,
      note: note.trim() || null,
    });
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>
        <code>{locationCode}</code>
      </h3>
      <fieldset className="chips">
        <legend>{t('mark.damage')}</legend>
        {QUICK_DAMAGE.map((code) => (
          <button
            type="button"
            key={code}
            className={code === damageCode ? 'chip selected' : 'chip'}
            onClick={() => setDamageCode(code)}
          >
            <strong>{code}</strong> {DAMAGE_CODES[code]}
          </button>
        ))}
        <select
          value={damageCode}
          onChange={(e) => setDamageCode(e.target.value as DamageCode)}
          aria-label={t('mark.damage')}
        >
          {Object.entries(DAMAGE_CODES).map(([code, label]) => (
            <option key={code} value={code}>
              {code} {label}
            </option>
          ))}
        </select>
      </fieldset>
      <label className="field">
        {t('mark.component')}
        <select
          value={componentCode}
          onChange={(e) => setComponentCode(e.target.value as ComponentCode | '')}
        >
          <option value="">—</option>
          {Object.entries(COMPONENT_CODES).map(([code, label]) => (
            <option key={code} value={code}>
              {code} {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {t('mark.note')}
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <DictateButton
        onText={(text) => setNote((current) => (current ? `${current} ${text}` : text))}
      />
      <div className="row">
        <button type="button" className="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {t('mark.save')}
        </button>
      </div>
    </form>
  );
}
