/**
 * A train's wagon list, turned into gate-in handovers before the train
 * arrives, so the checker walks the train with a list and every container
 * already has its handover open: rail, the wagon's UIC number, the seals.
 *
 * The list is checked first, row by row: the container number against the
 * ISO 6346 check digit, the wagon number against the UIC check digit, the
 * size/type code, the seals. A wrong digit typed into the list would
 * otherwise become a handover of the wrong container. Bad rows are reported
 * with their line and the fix; the good rows go ahead.
 */

import type { Handover } from '@plomba/contracts';
import {
  type ContainerNumberError,
  formatWagonNumber,
  normaliseWagonNumber,
  parseContainerNumber,
  parseSizeType,
  parseWagonNumber,
} from '@plomba/core';
import { PlombaApiError, type PlombaClient } from '../shared/client.ts';
import { parseCsv } from '../shared/csv.ts';
import { containerName } from '../shared/format.ts';
import { handoverLinks } from '../shared/links.ts';

/** The columns of the wagon list, in any order. Seals are separated by semicolons. */
export const COLUMNS = ['wagon', 'container', 'size_type', 'seals'] as const;

export interface WagonListRow {
  readonly line: number;
  readonly wagon: string;
  readonly container: string;
  readonly sizeType: string;
  readonly seals: string;
}

/** A row that passed every check, in the forms Plomba stores. */
export interface PlannedContainer {
  readonly line: number;
  /** 12 digits. */
  readonly wagon: string;
  /** 11 characters. */
  readonly container: string;
  readonly sizeType: string | null;
  readonly seals: string[];
}

export interface RejectedRow {
  readonly line: number;
  readonly wagon: string;
  readonly container: string;
  readonly problems: string[];
}

export interface TrainPlan {
  readonly planned: PlannedContainer[];
  readonly rejected: RejectedRow[];
}

export class WagonListError extends Error {
  override name = 'WagonListError';
}

/** Reads the CSV. Throws WagonListError when the header doesn't have the columns. */
export function parseWagonList(csv: string): WagonListRow[] {
  const [head, ...rows] = parseCsv(csv);
  if (!head) throw new WagonListError('The wagon list is empty');
  const names = head.fields.map((f) => f.trim().toLowerCase());
  const missing = COLUMNS.filter((c) => !names.includes(c));
  if (missing.length > 0) {
    throw new WagonListError(
      `The wagon list's first line must name the columns ${COLUMNS.join(', ')}; missing: ${missing.join(', ')}`,
    );
  }
  const at = (fields: string[], column: (typeof COLUMNS)[number]) =>
    (fields[names.indexOf(column)] ?? '').trim();
  return rows.map(({ line, fields }) => ({
    line,
    wagon: at(fields, 'wagon'),
    container: at(fields, 'container'),
    sizeType: at(fields, 'size_type'),
    seals: at(fields, 'seals'),
  }));
}

/** Checks every row; a row with any problem is rejected whole. */
export function planTrain(rows: readonly WagonListRow[]): TrainPlan {
  const planned: PlannedContainer[] = [];
  const rejected: RejectedRow[] = [];
  const lineOf = new Map<string, number>();

  for (const row of rows) {
    const problems: string[] = [];

    const container = parseContainerNumber(row.container);
    if (!container.ok) {
      problems.push(containerProblem(row.container, container.error));
    } else if (lineOf.has(container.value.value)) {
      problems.push(
        `container ${container.value.value} is already on line ${lineOf.get(container.value.value)}`,
      );
    }

    const wagon = parseWagonNumber(row.wagon);
    if (!wagon.ok) problems.push(wagonProblem(row.wagon, wagon.expected));

    const sizeType = row.sizeType ? parseSizeType(row.sizeType) : undefined;
    if (row.sizeType && !sizeType) {
      problems.push(`"${row.sizeType}" is not an ISO 6346 size/type code (e.g. 22G1, 45G1)`);
    }

    const seals = row.seals
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (seals.length > 10) problems.push(`${seals.length} seals; Plomba takes up to 10`);
    for (const seal of seals.filter((s) => s.length > 40)) {
      problems.push(`seal "${seal.slice(0, 20)}…" is longer than 40 characters`);
    }

    if (!container.ok || !wagon.ok || problems.length > 0) {
      rejected.push({ line: row.line, wagon: row.wagon, container: row.container, problems });
      continue;
    }
    lineOf.set(container.value.value, row.line);
    planned.push({
      line: row.line,
      wagon: wagon.value,
      container: container.value.value,
      sizeType: sizeType?.code ?? null,
      seals,
    });
  }
  return { planned, rejected };
}

function containerProblem(raw: string, error: ContainerNumberError): string {
  const shown = raw || '(empty)';
  switch (error.code) {
    case 'length':
      return `container number ${shown} has ${error.length} characters; ISO 6346 numbers have 11`;
    case 'owner-code':
      return `container number ${shown}: the owner code (first three characters) must be letters`;
    case 'category':
      return `container number ${shown}: the fourth character must be U, J or Z`;
    case 'serial':
      return `container number ${shown}: the last seven characters must be digits`;
    case 'check-digit-mismatch':
      return `container number ${shown} fails the ISO 6346 check digit: it should end in ${error.expected}, not ${error.found}`;
  }
}

function wagonProblem(raw: string, expected: number | undefined): string {
  if (expected === undefined) {
    return `wagon number ${raw || '(empty)'} must have 12 digits`;
  }
  return `wagon number ${formatWagonNumber(normaliseWagonNumber(raw))} fails the UIC check digit: it should end in ${expected}`;
}

// Opening the handovers -------------------------------------------------------

export interface ArrivalOptions {
  /** The terminal, as the checkers know it. */
  readonly place: string;
  /** Who checks the train. */
  readonly checker: string;
  /** The railway undertaking handing the containers over. */
  readonly handedOverBy?: string;
  /** Who receives them; the terminal by default. */
  readonly receivedBy?: string;
}

export type Arrival =
  | { readonly status: 'opened'; readonly row: PlannedContainer; readonly handover: Handover }
  | {
      readonly status: 'already-open';
      readonly row: PlannedContainer;
      /** The handover that is open, when it could be found. */
      readonly handover: Handover | undefined;
    }
  | { readonly status: 'failed'; readonly row: PlannedContainer; readonly error: string };

/**
 * Registers each container (registering one that exists is harmless) and
 * opens its gate-in handover. A container that already has an open handover
 * is reported with it, so running the list twice does no harm; a row the
 * server refuses is reported and the rest go ahead.
 */
export async function openArrivals(
  client: PlombaClient,
  plan: TrainPlan,
  options: ArrivalOptions,
): Promise<Arrival[]> {
  const arrivals: Arrival[] = [];
  for (const row of plan.planned) {
    try {
      await client.registerContainer({ number: row.container, sizeTypeCode: row.sizeType });
      const handover = await client.startHandover({
        containerNumber: row.container,
        direction: 'in',
        place: options.place,
        checker: options.checker,
        sealNumbers: row.seals,
        transportMode: 'rail',
        vehicleId: row.wagon,
        ...(options.handedOverBy ? { handedOverBy: options.handedOverBy } : {}),
        receivedBy: options.receivedBy ?? options.place,
      });
      arrivals.push({ status: 'opened', row, handover });
    } catch (error) {
      // Not reaching the server, or a refused token, stops the run; a refused row doesn't.
      if (!(error instanceof PlombaApiError) || error.status === 401 || error.status === 403) {
        throw error;
      }
      if (error.status === 409) {
        const { handovers } = await client.containerHistory(row.container);
        arrivals.push({
          status: 'already-open',
          row,
          handover: handovers.find((h) => h.status === 'open'),
        });
      } else {
        arrivals.push({ status: 'failed', row, error: error.problem?.title ?? error.message });
      }
    }
  }
  return arrivals;
}

// The checker's list -----------------------------------------------------------

export interface ChecklistOptions {
  readonly baseUrl: string;
  readonly place: string;
  /** The train's number, for the heading. */
  readonly train?: string;
}

/** The list the checker walks the train with: wagon by wagon, each container with its handover. */
export function checkerList(
  plan: TrainPlan,
  arrivals: readonly Arrival[] | undefined,
  options: ChecklistOptions,
): string {
  const lines: string[] = [];
  const wagons = new Set(plan.planned.map((p) => p.wagon)).size;
  lines.push(
    `${options.train ? `Train ${options.train}` : 'Train'} at ${options.place}: ` +
      `${plan.planned.length} container(s) on ${wagons} wagon(s)` +
      (plan.rejected.length > 0 ? `, ${plan.rejected.length} row(s) refused` : ''),
    '',
  );

  const byLine = new Map(arrivals?.map((a) => [a.row.line, a]));
  plan.planned.forEach((row, i) => {
    const seals = row.seals.length > 0 ? `seals ${row.seals.join(', ')}` : 'no seals listed';
    lines.push(
      `${String(i + 1).padStart(2)}. Wagon ${formatWagonNumber(row.wagon)}  ${containerName(row.container)}` +
        `${row.sizeType ? ` (${row.sizeType})` : ''}  ${seals}`,
    );
    const arrival = byLine.get(row.line);
    lines.push(`    ${arrivalLine(arrival, options.baseUrl)}`);
  });

  if (plan.rejected.length > 0) {
    lines.push('', 'Refused (correct the wagon list and run it again):');
    for (const row of plan.rejected) {
      lines.push(`  line ${row.line}: ${row.problems.join('; ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function arrivalLine(arrival: Arrival | undefined, baseUrl: string): string {
  if (!arrival) return 'checked, not opened (dry run)';
  switch (arrival.status) {
    case 'opened':
      return `opened: ${handoverLinks(baseUrl, arrival.handover).app}`;
    case 'already-open':
      return arrival.handover
        ? `already open (${arrival.handover.place}, ${arrival.handover.checker}): ${handoverLinks(baseUrl, arrival.handover).app}`
        : 'already has an open handover';
    case 'failed':
      return `not opened: ${arrival.error}`;
  }
}
