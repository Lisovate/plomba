/**
 * A container's damage history across its sealed handovers: where each damage
 * was first recorded, and the latest earlier handover that inspected the same
 * spot without recording it. The damage happened between the two, which
 * narrows a dispute down to the legs (and holders) in between.
 */

import { faceCells } from './cedex.ts';
import { type Face, type FaceRect, rectOverlap } from './faces.ts';
import type { ContainerDimensions } from './size-type.ts';

export type PassportStatus = 'new' | 'still-there' | 'changed' | 'repaired';

export interface PassportMark {
  readonly id: string;
  readonly face: Face;
  readonly rect: FaceRect;
  readonly locationCode: string;
  readonly damageCode: string | null;
  readonly status: PassportStatus;
  /** The mark of an earlier handover this one confirms, changes or repairs. */
  readonly previousMarkId: string | null;
}

export interface PassportHandover {
  readonly id: string;
  /**
   * CEDEX cells with no photo at this handover, by face. Missing in records
   * that didn't track coverage, which then can't show that a spot was clean.
   */
  readonly notInspected?: Partial<Record<Face, readonly string[]>>;
  readonly marks: readonly PassportMark[];
}

export interface DamageHistory {
  /** The id of the mark that first recorded it. */
  readonly id: string;
  readonly face: Face;
  /** Where it is now: the latest mark's rectangle and codes. */
  readonly rect: FaceRect;
  readonly locationCode: string;
  readonly damageCode: string | null;
  readonly status: PassportStatus;
  /** The handover that first recorded it. */
  readonly firstRecorded: string;
  /**
   * The latest earlier handover that inspected the spot and recorded nothing
   * there; `null` when no earlier handover did.
   */
  readonly lastClear: string | null;
  /** Earlier handovers after `lastClear` that didn't photograph the spot. */
  readonly notInspectedAt: string[];
  /**
   * An earlier handover that recorded damage on the same spot, which this
   * damage doesn't continue: possibly the same damage, recorded afresh. The
   * search for a clear handover stops there.
   */
  readonly recordedNearbyAt: string | null;
  /**
   * Every handover that recorded it, oldest first, with the codes as that
   * handover recorded them, so a statement about an earlier handover (an
   * off-hire, a claim) can quote what was on record then.
   */
  readonly trail: {
    readonly handoverId: string;
    readonly markId: string;
    readonly status: PassportStatus;
    readonly locationCode: string;
    readonly damageCode: string | null;
  }[];
}

/** The CEDEX cells of a face a rectangle overlaps. */
function cellsUnder(face: Face, rect: FaceRect, dimensions: ContainerDimensions): string[] {
  return faceCells(face, dimensions)
    .filter(({ rect: c }) => c.u0 < rect.u1 && rect.u0 < c.u1 && c.v0 < rect.v1 && rect.v0 < c.v1)
    .map((cell) => cell.code);
}

/**
 * Follows every damage through the handovers (oldest first). A mark starts a
 * new damage unless it points at an earlier handover's mark.
 */
export function damageHistory(
  handovers: readonly PassportHandover[],
  dimensions: ContainerDimensions,
): DamageHistory[] {
  const rootOf = new Map<string, string>();
  const histories = new Map<string, DamageHistory>();

  handovers.forEach((handover, index) => {
    for (const mark of handover.marks) {
      const root = mark.previousMarkId ? rootOf.get(mark.previousMarkId) : undefined;
      const existing = root ? histories.get(root) : undefined;
      if (root && existing) {
        rootOf.set(mark.id, root);
        const damageCode = mark.damageCode ?? existing.damageCode;
        histories.set(root, {
          ...existing,
          rect: mark.rect,
          locationCode: mark.locationCode,
          damageCode,
          status: mark.status,
          trail: [
            ...existing.trail,
            {
              handoverId: handover.id,
              markId: mark.id,
              status: mark.status,
              locationCode: mark.locationCode,
              damageCode,
            },
          ],
        });
        continue;
      }
      rootOf.set(mark.id, mark.id);
      const cells = cellsUnder(mark.face, mark.rect, dimensions);
      const notInspectedAt: string[] = [];
      let lastClear: string | null = null;
      let recordedNearbyAt: string | null = null;
      for (let i = index - 1; i >= 0; i--) {
        const earlier = handovers[i] as PassportHandover;
        // Damage recorded on the same spot (and not found repaired) means the spot wasn't clear.
        const nearby = earlier.marks.some(
          (m) =>
            m.face === mark.face && m.status !== 'repaired' && rectOverlap(m.rect, mark.rect) > 0,
        );
        if (nearby) {
          recordedNearbyAt = earlier.id;
          break;
        }
        const skipped = earlier.notInspected?.[mark.face];
        if (!earlier.notInspected || cells.some((code) => skipped?.includes(code))) {
          notInspectedAt.push(earlier.id);
          continue;
        }
        lastClear = earlier.id;
        break;
      }
      histories.set(mark.id, {
        id: mark.id,
        face: mark.face,
        rect: mark.rect,
        locationCode: mark.locationCode,
        damageCode: mark.damageCode,
        status: mark.status,
        firstRecorded: handover.id,
        lastClear,
        notInspectedAt: notInspectedAt.reverse(),
        recordedNearbyAt,
        trail: [
          {
            handoverId: handover.id,
            markId: mark.id,
            status: mark.status,
            locationCode: mark.locationCode,
            damageCode: mark.damageCode,
          },
        ],
      });
    }
  });
  return [...histories.values()];
}
