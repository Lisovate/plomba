/**
 * What a lessee is charged for at off-hire: the damage first recorded after
 * the on-hire handover, up to and including the off-hire one, on a spot a
 * handover photographed clean during the lease.
 *
 * Every item comes with its evidence: the handover that last showed the
 * spot clean, and the one that first recorded the damage, each with its
 * place, time and sealed record hash. Damage the records can't pin to the
 * lease (the on-hire survey didn't photograph the spot, or damage was
 * already recorded there) is listed for review, not charged.
 */

import type { ContainerHistory, DamageHistory, Handover } from '@plomba/contracts';
import {
  containerName,
  damageName,
  faceName,
  formatTime,
  legName,
  markdownTable,
  shortHash,
} from '../shared/format.ts';

export class LeaseError extends Error {
  override name = 'LeaseError';
}

export interface LeaseHandover {
  readonly id: string;
  readonly place: string;
  readonly at: string;
  readonly leg: string;
  readonly recordHash: string;
  /** Its position in the container's chain, from 1. */
  readonly position: number;
}

export interface LeaseItem {
  readonly damageId: string;
  readonly locationCode: string;
  readonly damageCode: string | null;
  /** E.g. `Dent (DT), right side`. */
  readonly description: string;
  readonly firstRecorded: LeaseHandover;
  /** The latest earlier handover that photographed the spot clean; null if none did. */
  readonly lastClear: LeaseHandover | null;
  /** Why an item is for review rather than charged. */
  readonly reason?: string;
}

export interface LeaseComparison {
  readonly container: string;
  readonly onHire: LeaseHandover;
  readonly offHire: LeaseHandover;
  readonly chainLength: number;
  /** First recorded during the lease, on a spot photographed clean during it. */
  readonly chargeable: LeaseItem[];
  /** First recorded during the lease, but the records don't show the spot clean during it. */
  readonly forReview: LeaseItem[];
  /** First recorded during the lease and repaired by off-hire. */
  readonly repairedDuringLease: LeaseItem[];
  /** On record at on-hire and not repaired by then: the lessee took it over. */
  readonly atOnHire: LeaseItem[];
}

/**
 * Compares two sealed handovers of a container's history. Throws LeaseError
 * when the chain doesn't verify, a handover isn't in it, or off-hire isn't
 * after on-hire.
 */
export function compareLease(
  history: ContainerHistory,
  onHireId: string,
  offHireId: string,
): LeaseComparison {
  if (!history.chain.ok) {
    throw new LeaseError(
      `The hash chain of ${history.container.number} breaks at record ${(history.chain.brokenAt ?? 0) + 1}: its records can't support a charge`,
    );
  }
  const sealed = new Map(history.handovers.filter(isSealed).map((h) => [h.id, h]));
  const find = (id: string, role: string): Sealed => {
    const h = sealed.get(id);
    if (h) return h;
    const open = history.handovers.some((x) => x.id === id);
    throw new LeaseError(
      open
        ? `The ${role} handover ${id} is not sealed yet`
        : `${history.container.number} has no handover ${id} (${role})`,
    );
  };
  const on = find(onHireId, 'on-hire');
  const off = find(offHireId, 'off-hire');
  if (off.seal.sequence <= on.seal.sequence) {
    throw new LeaseError('The off-hire handover must come after the on-hire one');
  }

  /** Position of a handover in the chain; -1 if unknown. */
  const seq = (id: string | null) => (id ? (sealed.get(id)?.seal.sequence ?? -1) : -1);
  /** The damage as the last handover up to `limit` that recorded it had it. */
  const recordBy = (d: DamageHistory, limit: number) =>
    d.trail.filter((step) => seq(step.handoverId) <= limit).at(-1);
  const statusBy = (d: DamageHistory, limit: number) => recordBy(d, limit)?.status;
  /**
   * One line of the statement, with the codes on record at `limit`: a later
   * handover may re-code the damage, and a statement already issued for this
   * lease must not change with it.
   */
  const item = (d: DamageHistory, limit: number, reason?: string): LeaseItem => {
    const record = recordBy(d, limit);
    const locationCode = record?.locationCode ?? d.locationCode;
    const damageCode = record ? record.damageCode : d.damageCode;
    const clear = d.lastClear ? sealed.get(d.lastClear) : undefined;
    const first = sealed.get(d.firstRecorded);
    if (!first) {
      throw new LeaseError(`The history names handover ${d.firstRecorded}, which it doesn't list`);
    }
    return {
      damageId: d.id,
      locationCode,
      damageCode,
      description: `${damageName(damageCode)}, ${faceName(d.face)}`,
      firstRecorded: lease(first),
      lastClear: clear ? lease(clear) : null,
      ...(reason ? { reason } : {}),
    };
  };

  const comparison: LeaseComparison = {
    container: history.container.number,
    onHire: lease(on),
    offHire: lease(off),
    chainLength: history.chain.length,
    chargeable: [],
    forReview: [],
    repairedDuringLease: [],
    atOnHire: [],
  };
  for (const d of history.damage) {
    const first = seq(d.firstRecorded);
    if (first <= on.seal.sequence) {
      if (statusBy(d, on.seal.sequence) !== 'repaired')
        comparison.atOnHire.push(item(d, on.seal.sequence));
      continue;
    }
    if (first > off.seal.sequence) continue; // after the lease
    if (statusBy(d, off.seal.sequence) === 'repaired') {
      comparison.repairedDuringLease.push(item(d, off.seal.sequence));
      continue;
    }
    const nearby = d.recordedNearbyAt ? sealed.get(d.recordedNearbyAt) : undefined;
    if (d.recordedNearbyAt) {
      comparison.forReview.push(
        item(
          d,
          off.seal.sequence,
          `damage was already recorded on this spot at ${nearby ? `${nearby.place}, ${formatTime(nearby.startedAt)}` : 'an earlier handover'}; it may be the same damage`,
        ),
      );
    } else if (d.lastClear && seq(d.lastClear) >= on.seal.sequence) {
      comparison.chargeable.push(item(d, off.seal.sequence));
    } else if (d.lastClear) {
      comparison.forReview.push(
        item(
          d,
          off.seal.sequence,
          'the on-hire survey didn’t photograph this spot; it was last seen clean before the lease',
        ),
      );
    } else {
      comparison.forReview.push(
        item(d, off.seal.sequence, 'no handover photographed this spot clean'),
      );
    }
  }
  return comparison;
}

type Sealed = Handover & { readonly seal: NonNullable<Handover['seal']> };

const isSealed = (h: Handover): h is Sealed => h.seal !== null;

function lease(h: Sealed): LeaseHandover {
  return {
    id: h.id,
    place: h.place,
    at: h.startedAt,
    leg: legName(h),
    recordHash: h.seal.hash,
    position: h.seal.sequence + 1,
  };
}

/** The off-hire statement, in Markdown. */
export function leaseMarkdown(c: LeaseComparison): string {
  const where = (h: LeaseHandover) => `${h.place}, ${formatTime(h.at)} (#${h.position})`;
  const table = (items: readonly LeaseItem[], withReason: boolean) =>
    items.length === 0
      ? 'None.'
      : markdownTable(
          [
            'Location',
            'Damage',
            'Last clean',
            'First recorded',
            'Record hashes',
            ...(withReason ? ['Why'] : []),
          ],
          items.map((i) => [
            i.locationCode,
            i.description,
            i.lastClear ? where(i.lastClear) : '—',
            where(i.firstRecorded),
            [i.lastClear?.recordHash, i.firstRecorded.recordHash]
              .filter(Boolean)
              .map((hash) => `\`${shortHash(hash)}\``)
              .join(', '),
            ...(withReason ? [i.reason ?? ''] : []),
          ]),
        );
  const list = (items: readonly LeaseItem[]) =>
    items.length === 0
      ? 'None.'
      : items
          .map(
            (i) =>
              `- ${i.locationCode}: ${i.description}, first recorded at ${where(i.firstRecorded)}`,
          )
          .join('\n');

  return `# Off-hire statement: ${containerName(c.container)}

${markdownTable(
  ['', 'Handover', 'Record (SHA-256)'],
  [
    ['On-hire', `${where(c.onHire)}, ${c.onHire.leg}`, `\`${c.onHire.recordHash}\``],
    ['Off-hire', `${where(c.offHire)}, ${c.offHire.leg}`, `\`${c.offHire.recordHash}\``],
  ],
)}

The container's hash chain verified (${c.chainLength} sealed records). Numbers after a place are positions in the chain.

## Chargeable to the lessee (${c.chargeable.length})

${table(c.chargeable, false)}

## For review, not charged yet (${c.forReview.length})

${table(c.forReview, true)}

## Repaired during the lease (${c.repairedDuringLease.length})

${list(c.repairedDuringLease)}

## Already there at on-hire, not charged (${c.atOnHire.length})

${list(c.atOnHire)}
`;
}
