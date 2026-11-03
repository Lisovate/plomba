/**
 * What a claims desk does with a sealed handover: for each damage the
 * handover recorded, decide whether the records prove where it happened.
 *
 * - **Claim:** this handover first recorded the damage, and an earlier
 *   handover (`lastClear`) photographed the same spot clean. It happened
 *   between the two, so it is charged to whoever had the container then.
 * - **Review:** the records can't settle it alone. An earlier handover
 *   recorded damage on the same spot (`recordedNearbyAt`), no earlier
 *   handover photographed the spot (`notInspectedAt` with no `lastClear`),
 *   known damage got worse, or the container's hash chain doesn't verify.
 *   A person looks at the photos.
 * - **Skipped:** damage already on record and confirmed again, or recorded
 *   on the container's first sealed handover, with nothing earlier to
 *   compare it with.
 *
 * The webhook names the earlier handovers by id only, so the desk reads the
 * container's history from the API for their place, time, leg and hash.
 */

import type {
  ContainerHistory,
  DamageHistory,
  Direction,
  Face,
  Handover,
  TransportMode,
  WebhookEvent,
} from '@plomba/contracts';
import { componentName, damageName, faceName, formatTime, legName } from '../shared/format.ts';
import { handoverLinks } from '../shared/links.ts';

/** A handover as a claim cites it: where, when, on which leg, between whom, and its sealed record. */
export interface HandoverEvidence {
  readonly id: string;
  readonly place: string;
  readonly direction: Direction;
  /** E.g. `gate out, by road, truck EL 4K217`. */
  readonly leg: string;
  readonly transportMode: TransportMode | null;
  readonly vehicleId: string | null;
  readonly handedOverBy: string | null;
  readonly receivedBy: string | null;
  readonly checker: string;
  readonly startedAt: string;
  readonly sealedAt: string | null;
  /** The SHA-256 of the sealed record. */
  readonly recordHash: string | null;
  /** Its position in the container's hash chain, from 1. */
  readonly chainPosition: number | null;
  readonly links: { readonly app: string; readonly receipt: string; readonly codeco: string };
}

export interface DamageDescription {
  /** The id of the mark that first recorded it. */
  readonly id: string;
  readonly face: Face;
  /** The CEDEX location code, e.g. RL6N. */
  readonly locationCode: string;
  readonly damageCode: string | null;
  readonly componentCode: string | null;
  /** E.g. `Dent (DT), Panel (PAA), right side`. */
  readonly description: string;
  /** What the checker wrote. */
  readonly note: string | null;
}

interface CaseFile {
  /** Stable for the same damage, so processing an event twice rewrites the same files. */
  readonly id: string;
  readonly openedAt: string;
  readonly event: { readonly id: string; readonly occurredAt: string };
  readonly container: {
    readonly number: string;
    readonly sizeTypeCode: string | null;
    readonly link: string;
  };
  readonly damage: DamageDescription;
  /** Whether the container's hash chain verified when the file was opened. */
  readonly chain: { readonly verified: boolean; readonly length: number };
}

export interface Claim extends CaseFile {
  readonly kind: 'claim';
  /** The latest earlier handover whose photos show the spot clean. */
  readonly lastClear: HandoverEvidence;
  /** The handover that first recorded the damage: the one this event is about. */
  readonly firstRecorded: HandoverEvidence;
  /** Handovers in between that didn't photograph the spot: their legs are in the window too. */
  readonly notInspectedBetween: HandoverEvidence[];
  /** Who had the container between the two, as the records name them. */
  readonly custody: string[];
}

export type ReviewReason = 'recorded-nearby' | 'not-inspected' | 'changed' | 'unverified';

export interface Review extends CaseFile {
  readonly kind: 'review';
  readonly reason: ReviewReason;
  readonly explanation: string;
  /** The handover this event is about. */
  readonly handover: HandoverEvidence;
  /** The earlier handovers the reason is about. */
  readonly related: HandoverEvidence[];
}

export interface Skipped {
  readonly damageId: string;
  readonly locationCode: string;
  readonly reason: string;
}

export interface ClaimsDecision {
  readonly claims: Claim[];
  readonly reviews: Review[];
  readonly skipped: Skipped[];
}

/**
 * Decides, for each damage in a `handover.sealed` event, whether to open a
 * claim, file it for review, or skip it. `history` is the container's
 * history from GET /api/containers/{number}, read after the event arrived.
 */
export function buildClaims(
  event: WebhookEvent,
  history: ContainerHistory,
  options: { readonly now?: Date } = {},
): ClaimsDecision {
  const here = event.data.handover;
  const base = publicBase(event);
  const known = new Map(history.handovers.map((h) => [h.id, h]));
  const evidence = (h: Handover) => toEvidence(h, base);
  const cited = (id: string | null) => (id ? known.get(id) : undefined);

  const decision: ClaimsDecision = { claims: [], reviews: [], skipped: [] };
  for (const damage of event.data.damage) {
    const step = damage.trail.find((s) => s.handoverId === here.id);
    const markHere = event.data.marks.find((m) => m.id === (step?.markId ?? damage.id));
    const file: CaseFile = {
      id: `${event.data.container.number}-${damage.id}`,
      openedAt: (options.now ?? new Date()).toISOString(),
      event: { id: event.id, occurredAt: event.occurredAt },
      container: {
        number: event.data.container.number,
        sizeTypeCode: event.data.container.sizeTypeCode,
        link: event.data.links.container,
      },
      damage: describeDamage(damage, markHere?.componentCode ?? null, markHere?.note ?? null),
      chain: { verified: history.chain.ok, length: history.chain.length },
    };
    const review = (reason: ReviewReason, explanation: string, related: Handover[]) =>
      decision.reviews.push({
        kind: 'review',
        ...file,
        reason,
        explanation,
        handover: evidence(here),
        related: related.map(evidence),
      });

    // Damage first recorded earlier, seen again here.
    if (damage.firstRecorded !== here.id) {
      const first = cited(damage.firstRecorded);
      if (step?.status === 'changed') {
        review(
          'changed',
          `First recorded at ${where(first)}, and marked as changed at this handover: it may have got worse on the last leg. Compare the photos of the two handovers.`,
          first ? [first] : [],
        );
      } else {
        decision.skipped.push({
          damageId: damage.id,
          locationCode: damage.locationCode,
          reason: `already on record since ${where(first)}; ${step?.status ?? 'seen'} here`,
        });
      }
      continue;
    }

    // Damage this handover recorded first.
    const clear = cited(damage.lastClear);
    const nearby = cited(damage.recordedNearbyAt);
    const between = damage.notInspectedAt.flatMap((id) => known.get(id) ?? []);
    const missing = [damage.lastClear, damage.recordedNearbyAt, ...damage.notInspectedAt].some(
      (id) => id !== null && !known.has(id),
    );
    if (!history.chain.ok || missing) {
      review(
        'unverified',
        history.chain.ok
          ? "The container's history doesn't include the handovers this event names, so the records can't support a claim. Ask the installation's operator."
          : `The container's hash chain doesn't verify (broken at record ${(history.chain.brokenAt ?? 0) + 1}), so its records can't support a claim. Ask the installation's operator.`,
        [],
      );
    } else if (nearby) {
      review(
        'recorded-nearby',
        `An earlier handover, at ${where(nearby)}, recorded damage on the same spot, and this damage isn't linked to it. It may be the same damage recorded again; compare the photos before claiming.`,
        [nearby],
      );
    } else if (clear) {
      decision.claims.push({
        kind: 'claim',
        ...file,
        lastClear: evidence(clear),
        firstRecorded: evidence(here),
        notInspectedBetween: between.map(evidence),
        custody: custodyBetween(clear, between, here),
      });
    } else if (between.length > 0) {
      review(
        'not-inspected',
        `No earlier handover photographed this spot (${between.map(where).join('; ')}), so nothing shows it clean and the leg it happened on can't be told from the records.`,
        between,
      );
    } else {
      decision.skipped.push({
        damageId: damage.id,
        locationCode: damage.locationCode,
        reason: "on the container's first sealed record: there is nothing earlier to compare with",
      });
    }
  }
  return decision;
}

/**
 * Who had the container between a clean handover and the one that found
 * the damage: whoever received it at the first, handed it over at the last,
 * and both parties of any handover in between.
 */
function custodyBetween(clear: Handover, between: readonly Handover[], found: Handover): string[] {
  const names = [
    clear.receivedBy,
    ...between.flatMap((h) => [h.handedOverBy, h.receivedBy]),
    found.handedOverBy,
  ];
  return [...new Set(names.map((n) => n?.trim()).filter((n): n is string => Boolean(n)))];
}

function describeDamage(
  damage: DamageHistory,
  componentCode: string | null,
  note: string | null,
): DamageDescription {
  const component = componentName(componentCode);
  return {
    id: damage.id,
    face: damage.face,
    locationCode: damage.locationCode,
    damageCode: damage.damageCode,
    componentCode,
    description: [damageName(damage.damageCode), component, faceName(damage.face)]
      .filter(Boolean)
      .join(', '),
    note,
  };
}

function toEvidence(h: Handover, base: string): HandoverEvidence {
  const links = handoverLinks(base, h);
  return {
    id: h.id,
    place: h.place,
    direction: h.direction,
    leg: legName(h),
    transportMode: h.transportMode,
    vehicleId: h.vehicleId,
    handedOverBy: h.handedOverBy,
    receivedBy: h.receivedBy,
    checker: h.checker,
    startedAt: h.startedAt,
    sealedAt: h.closedAt,
    recordHash: h.seal?.hash ?? null,
    chainPosition: h.seal ? h.seal.sequence + 1 : null,
    links: { app: links.app, receipt: links.receipt, codeco: links.codeco },
  };
}

/** `Gdynia container terminal, 2026-10-28 08:00 UTC`. */
function where(h: Handover | undefined): string {
  return h ? `${h.place}, ${formatTime(h.startedAt)}` : 'an earlier handover';
}

/**
 * The installation's public address, read from the event's own links, so
 * the links to earlier handovers point where the event's links point.
 */
function publicBase(event: WebhookEvent): string {
  const suffix = `/handovers/${event.data.handover.id}`;
  const app = event.data.links.app;
  return app.endsWith(suffix) ? app.slice(0, -suffix.length) : new URL(app).origin;
}
