/**
 * A container's damage history across its sealed handovers: where each damage
 * was first recorded, and the latest earlier handover that inspected the same
 * spot without recording it. The damage happened between the two, which
 * narrows a dispute down to the legs (and holders) in between.
 */

import { faceCells } from './cedex.ts';
import type { Face, FaceRect } from './faces.ts';
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
  /** CEDEX cells with no photo at this handover, by face. Missing in records that didn't track coverage. */
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
  /** Every handover that recorded it, oldest first. */
  readonly trail: {
    readonly handoverId: string;
    readonly markId: string;
    readonly status: PassportStatus;
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
        histories.set(root, {
          ...existing,
          rect: mark.rect,
          locationCode: mark.locationCode,
          damageCode: mark.damageCode ?? existing.damageCode,
          status: mark.status,
          trail: [
            ...existing.trail,
            { handoverId: handover.id, markId: mark.id, status: mark.status },
          ],
        });
        continue;
      }
      rootOf.set(mark.id, mark.id);
      const cells = cellsUnder(mark.face, mark.rect, dimensions);
      const notInspectedAt: string[] = [];
      let lastClear: string | null = null;
      for (let i = index - 1; i >= 0; i--) {
        const earlier = handovers[i] as PassportHandover;
        const skipped = new Set(earlier.notInspected?.[mark.face] ?? []);
        if (cells.some((code) => skipped.has(code))) {
          notInspectedAt.push(earlier.id);
        } else {
          lastClear = earlier.id;
          break;
        }
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
        trail: [{ handoverId: handover.id, markId: mark.id, status: mark.status }],
      });
    }
  });
  return [...histories.values()];
}
