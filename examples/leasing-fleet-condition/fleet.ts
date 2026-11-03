/**
 * A fleet condition report for a container owner: every container with the
 * owner's code, its open and repaired damage, its last handover, and whether
 * its hash chain verifies.
 *
 * Damage comes from the sealed records only. When a container's chain
 * doesn't verify, Plomba gives no damage for it, and the report says the
 * damage is unknown rather than showing none.
 */

import type {
  ContainerHistory,
  ContainerSummary,
  DamageHistory,
  Handover,
} from '@plomba/contracts';
import type { PlombaClient } from '../shared/client.ts';
import { toCsv } from '../shared/csv.ts';
import {
  containerName,
  damageName,
  faceName,
  formatTime,
  legName,
  markdownTable,
} from '../shared/format.ts';
import { containerLink } from '../shared/links.ts';

/** GET /api/containers returns at most this many. */
export const FLEET_LIMIT = 500;

export interface DamageLine {
  readonly id: string;
  readonly locationCode: string;
  readonly damageCode: string | null;
  /** E.g. `Dent (DT), right side`. */
  readonly description: string;
  readonly status: DamageHistory['status'];
  readonly firstRecorded: { readonly place: string; readonly at: string } | null;
}

export interface ContainerCondition {
  readonly number: string;
  readonly sizeTypeCode: string | null;
  readonly handovers: number;
  readonly sealed: number;
  readonly lastHandover: {
    readonly id: string;
    readonly place: string;
    readonly at: string;
    readonly leg: string;
    readonly status: Handover['status'];
  } | null;
  /** `none`: nothing sealed yet. */
  readonly chain: 'verified' | 'broken' | 'none';
  /** The record (from 1) where the chain breaks. */
  readonly brokenAt: number | null;
  /** Null when the chain doesn't verify: the damage is unknown, not absent. */
  readonly damage: { readonly open: DamageLine[]; readonly repaired: DamageLine[] } | null;
  readonly link: string;
}

/** One container's condition, from its summary in the fleet list and its history. */
export function conditionOf(
  summary: ContainerSummary,
  history: ContainerHistory,
  baseUrl: string,
): ContainerCondition {
  const handovers = new Map(history.handovers.map((h) => [h.id, h]));
  const line = (d: DamageHistory): DamageLine => {
    const first = handovers.get(d.firstRecorded);
    return {
      id: d.id,
      locationCode: d.locationCode,
      damageCode: d.damageCode,
      description: `${damageName(d.damageCode)}, ${faceName(d.face)}`,
      status: d.status,
      firstRecorded: first ? { place: first.place, at: first.startedAt } : null,
    };
  };
  const last = summary.lastHandover;
  return {
    number: summary.number,
    sizeTypeCode: summary.sizeTypeCode,
    handovers: summary.handoverCount,
    sealed: summary.sealedCount,
    lastHandover: last
      ? {
          id: last.id,
          place: last.place,
          at: last.startedAt,
          leg: legName(last),
          status: last.status,
        }
      : null,
    chain: !history.chain.ok ? 'broken' : history.chain.length === 0 ? 'none' : 'verified',
    brokenAt: history.chain.brokenAt === null ? null : history.chain.brokenAt + 1,
    damage: history.chain.ok
      ? {
          open: history.damage.filter((d) => d.status !== 'repaired').map(line),
          repaired: history.damage.filter((d) => d.status === 'repaired').map(line),
        }
      : null,
    link: containerLink(baseUrl, summary.number),
  };
}

export interface FleetReport {
  readonly owner: string;
  readonly generatedAt: string;
  readonly containers: ContainerCondition[];
  /** True when the list hit the API's limit, so the fleet may be larger. */
  readonly truncated: boolean;
}

/** Reads the owner's containers, then each one's history, a few at a time. */
export async function fleetReport(
  client: PlombaClient,
  owner: string,
  options: { readonly concurrency?: number; readonly now?: Date } = {},
): Promise<FleetReport> {
  const summaries = await client.listContainers({ owner, limit: FLEET_LIMIT });
  const containers = await mapLimit(summaries, options.concurrency ?? 4, async (summary) =>
    conditionOf(summary, await client.containerHistory(summary.number), client.baseUrl),
  );
  return {
    owner: owner.toUpperCase(),
    generatedAt: (options.now ?? new Date()).toISOString(),
    containers,
    truncated: summaries.length >= FLEET_LIMIT,
  };
}

/** One line per container, for a fleet system or a spreadsheet. */
export function fleetCsv(report: FleetReport): string {
  const codes = (lines: readonly DamageLine[]) =>
    lines.map((d) => `${d.locationCode} ${d.damageCode ?? '?'}`).join('; ');
  return toCsv([
    [
      'container',
      'size_type',
      'handovers',
      'sealed',
      'chain',
      'open_damage',
      'open_codes',
      'repaired_damage',
      'repaired_codes',
      'last_handover_at',
      'last_handover_place',
      'last_handover_leg',
      'last_handover_status',
    ],
    ...report.containers.map((c) => [
      c.number,
      c.sizeTypeCode,
      c.handovers,
      c.sealed,
      c.chain === 'broken' ? `broken at ${c.brokenAt}` : c.chain,
      c.damage ? c.damage.open.length : null,
      c.damage ? codes(c.damage.open) : 'unknown',
      c.damage ? c.damage.repaired.length : null,
      c.damage ? codes(c.damage.repaired) : 'unknown',
      c.lastHandover?.at ?? null,
      c.lastHandover?.place ?? null,
      c.lastHandover?.leg ?? null,
      c.lastHandover?.status ?? null,
    ]),
  ]);
}

const STATUS: Readonly<Record<DamageHistory['status'], string>> = {
  new: 'open',
  'still-there': 'open, seen again since',
  changed: 'open, changed since',
  repaired: 'repaired',
};

/** The report for people: a summary table, then each container's damage. */
export function fleetMarkdown(report: FleetReport): string {
  const withDamage = report.containers.filter((c) => (c.damage?.open.length ?? 0) > 0).length;
  const broken = report.containers.filter((c) => c.chain === 'broken').length;
  const out = [
    `# Fleet condition: ${report.owner}`,
    '',
    `${report.containers.length} container(s), ${withDamage} with open damage` +
      (broken > 0 ? `, ${broken} whose records don't verify` : '') +
      `. Generated ${formatTime(report.generatedAt)} from Plomba's sealed records.`,
    ...(report.truncated
      ? ['', `The list stopped at ${FLEET_LIMIT} containers; the fleet may be larger.`]
      : []),
    '',
    markdownTable(
      ['Container', 'Type', 'Chain', 'Open', 'Repaired', 'Last handover'],
      report.containers.map((c) => [
        containerName(c.number),
        c.sizeTypeCode ?? '—',
        c.chain === 'broken' ? `**broken at ${c.brokenAt}**` : c.chain,
        c.damage ? String(c.damage.open.length) : 'unknown',
        c.damage ? String(c.damage.repaired.length) : 'unknown',
        c.lastHandover
          ? `${c.lastHandover.place}, ${formatTime(c.lastHandover.at)}, ${c.lastHandover.leg}${c.lastHandover.status === 'open' ? ' (open)' : ''}`
          : 'none yet',
      ]),
    ),
  ];
  for (const c of report.containers) {
    if (c.damage && c.damage.open.length + c.damage.repaired.length === 0) continue;
    out.push('', `## ${containerName(c.number)}`, '');
    if (!c.damage) {
      out.push(
        `The hash chain breaks at record ${c.brokenAt}, so the damage history can't be relied on. Ask the installation's operator. ${c.link}`,
      );
      continue;
    }
    const rows = [...c.damage.open, ...c.damage.repaired].map((d) => [
      d.locationCode,
      d.description,
      STATUS[d.status],
      d.firstRecorded ? `${d.firstRecorded.place}, ${formatTime(d.firstRecorded.at)}` : '—',
    ]);
    out.push(markdownTable(['Location', 'Damage', 'Status', 'First recorded'], rows), '', c.link);
  }
  return `${out.join('\n')}\n`;
}

/** Maps with at most `limit` calls in flight, keeping the order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
