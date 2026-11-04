import type { ContainerHistory, DamageHistory, Handover } from '@plomba/contracts';
import { type Face, parseSizeType } from '@plomba/core';
import type { Language, Translate } from '../i18n/index.tsx';

/** Repaired damage and an unverified passport must never appear as open damage. */
export function openDamageInView(
  history: Pick<ContainerHistory, 'chain' | 'damage'>,
  faces: readonly Face[],
): DamageHistory[] {
  return history.chain.ok
    ? history.damage.filter((damage) => damage.status !== 'repaired' && faces.includes(damage.face))
    : [];
}

export function describeSizeType(code: string | null, t: Translate): string {
  const sizeType = code ? parseSizeType(code) : undefined;
  if (!sizeType) return code ?? t('try.sizeUnknown');
  return `${sizeType.code} · ${sizeType.lengthFeet} ft ${t(`containerType.${sizeType.typeGroup}`)}${sizeType.highCube ? ` · ${t('try.highCube')}` : ''}`;
}

function date(value: string, language: Language): string {
  return new Date(value).toLocaleDateString(language, { dateStyle: 'medium' });
}

export function firstRecordedLabel(
  damage: DamageHistory,
  handovers: readonly Handover[],
  t: Translate,
  language: Language,
): string {
  const first = handovers.find((handover) => handover.id === damage.firstRecorded);
  return first
    ? t('try.firstRecorded', {
        place: first.place,
        date: date(first.closedAt ?? first.startedAt, language),
      })
    : t('try.originUnknown');
}

export function informationLines(history: ContainerHistory, t: Translate, language: Language) {
  // The last sealed handover: an open one can still change, so it isn't the container's record yet.
  const last = history.handovers
    .filter((handover) => handover.status === 'closed')
    .reduce<Handover | undefined>(
      (latest, handover) =>
        !latest || Date.parse(handover.startedAt) > Date.parse(latest.startedAt)
          ? handover
          : latest,
      undefined,
    );
  return {
    sizeType: describeSizeType(history.container.sizeTypeCode, t),
    lastHandover: last
      ? t('try.lastHandover', {
          place: last.place,
          direction: t(last.direction === 'in' ? 'handover.in' : 'handover.out'),
          date: date(last.closedAt ?? last.startedAt, language),
        })
      : t('try.noHandovers'),
    chain: !history.chain.ok
      ? t('try.chainBroken')
      : history.chain.length > 0
        ? t('try.chainVerified', { count: history.chain.length })
        : t('try.noSealed'),
  };
}
