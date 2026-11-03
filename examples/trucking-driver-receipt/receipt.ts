/**
 * The driver's receipt for a handover at a terminal gate: what was handed
 * over, where and when, the damage on record at that moment, and the sealed
 * record's hash, so that a later "this dent wasn't there when you took it"
 * can be answered with the record, not with memory.
 *
 * The receipt is checked when it is made: the container's hash chain must
 * verify, and the handover in the chain must carry the hash printed.
 */

import type { ContainerHistory, Handover, HandoverDetail, Mark } from '@plomba/contracts';
import type { PlombaClient } from '../shared/client.ts';
import {
  componentName,
  containerName,
  damageName,
  directionName,
  escapeHtml,
  faceName,
  formatTime,
  legName,
} from '../shared/format.ts';
import { type HandoverLinks, handoverLinks } from '../shared/links.ts';

/** Registrations compare without spaces, dashes or case: `el4k217` is `EL 4K217`. */
export function sameRegistration(a: string, b: string): boolean {
  const plain = (s: string) => s.toUpperCase().replace(/[\s.-]/g, '');
  return plain(a) === plain(b);
}

/**
 * The latest sealed handover of a truck: from the container's whole history
 * when the container is known, else from the installation's recent
 * handovers (the API has no search by vehicle).
 */
export async function findLatestSealed(
  client: PlombaClient,
  search: { readonly truck: string; readonly container?: string },
): Promise<Handover | undefined> {
  const candidates: readonly Handover[] = search.container
    ? (await client.containerHistory(search.container)).handovers
    : await client.recentHandovers();
  return candidates
    .filter(
      (h) =>
        h.seal !== null &&
        h.transportMode !== 'rail' &&
        h.vehicleId !== null &&
        sameRegistration(h.vehicleId, search.truck),
    )
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
}

export interface ReceiptDamage {
  readonly locationCode: string;
  /** E.g. `Dent (DT)`. */
  readonly damage: string;
  readonly component: string | null;
  readonly face: string;
  /** Whether this handover found it, or it was already on record. */
  readonly status: 'new' | 'already recorded' | 'changed' | 'repaired';
  readonly note: string | null;
}

export interface Receipt {
  readonly container: { readonly number: string; readonly sizeTypeCode: string | null };
  readonly movement: string;
  readonly leg: string;
  readonly place: string;
  readonly at: string;
  readonly sealedAt: string | null;
  readonly checker: string;
  readonly handedOverBy: string | null;
  readonly receivedBy: string | null;
  readonly seals: readonly string[];
  readonly damage: readonly ReceiptDamage[];
  readonly record: {
    readonly hash: string;
    readonly previousHash: string;
    /** Its position in the container's chain, from 1. */
    readonly position: number;
    readonly chainLength: number;
    /** The chain verified and holds this hash at this position, when the receipt was made. */
    readonly verified: boolean;
  };
  readonly links: HandoverLinks;
}

const STATUS: Readonly<Record<Mark['status'], ReceiptDamage['status']>> = {
  new: 'new',
  'still-there': 'already recorded',
  changed: 'changed',
  repaired: 'repaired',
};

/** The receipt of a sealed handover. Throws if the handover isn't sealed. */
export function buildReceipt(
  detail: HandoverDetail,
  history: ContainerHistory,
  baseUrl: string,
): Receipt {
  const { handover, container } = detail;
  if (!handover.seal) throw new Error(`Handover ${handover.id} is not sealed yet`);
  const inChain = history.handovers.find((h) => h.id === handover.id);
  return {
    container: { number: container.number, sizeTypeCode: container.sizeTypeCode },
    movement: directionName(handover.direction),
    leg: legName(handover),
    place: handover.place,
    at: handover.startedAt,
    sealedAt: handover.closedAt,
    checker: handover.checker,
    handedOverBy: handover.handedOverBy,
    receivedBy: handover.receivedBy,
    seals: handover.sealNumbers,
    damage: detail.marks
      .filter((m) => m.source === 'confirmed')
      .map((m) => ({
        locationCode: m.locationCode,
        damage: damageName(m.damageCode),
        component: componentName(m.componentCode),
        face: faceName(m.face),
        status: STATUS[m.status],
        note: m.note,
      })),
    record: {
      hash: handover.seal.hash,
      previousHash: handover.seal.previousHash,
      position: handover.seal.sequence + 1,
      chainLength: history.chain.length,
      verified: history.chain.ok && inChain?.seal?.hash === handover.seal.hash,
    },
    links: handoverLinks(baseUrl, handover),
  };
}

/** Finds the truck's latest sealed handover and makes its receipt; undefined when there is none. */
export async function driverReceipt(
  client: PlombaClient,
  search: { readonly truck: string; readonly container?: string },
): Promise<Receipt | undefined> {
  const found = await findLatestSealed(client, search);
  if (!found) return undefined;
  const [detail, history] = await Promise.all([
    client.handover(found.id),
    client.containerHistory(found.containerNumber),
  ]);
  return buildReceipt(detail, history, client.baseUrl);
}

function howToCheck(r: Receipt): string[] {
  return [
    `Open the container's history (${r.links.container}), or ask the API for GET /api/containers/${r.container.number}:`,
    `the chain must be shown as verified, and handover ${r.record.position} must carry this hash.`,
    'Any change to the record after sealing would change its hash and break the chain.',
    'The same hash, in capitals, is in the CODECO gate message (FTX segment) sent to the line.',
  ];
}

export function receiptText(r: Receipt): string {
  const title = `${r.movement.toUpperCase()} RECEIPT  ${containerName(r.container.number)}${r.container.sizeTypeCode ? ` (${r.container.sizeTypeCode})` : ''}`;
  const parties = `${r.handedOverBy ?? '—'} → ${r.receivedBy ?? '—'}`;
  const lines = [
    title,
    '='.repeat(title.length),
    `Place:        ${r.place}`,
    `Time:         ${formatTime(r.at)} (sealed ${formatTime(r.sealedAt)})`,
    `Leg:          ${r.leg}`,
    `Handed over:  ${parties}`,
    `Checker:      ${r.checker}`,
    `Seals:        ${r.seals.length > 0 ? r.seals.join(', ') : 'none recorded'}`,
    '',
    r.damage.length > 0 ? `Damage recorded (${r.damage.length}):` : 'Damage recorded: none',
    ...r.damage.map(
      (d) =>
        `  ${d.locationCode.padEnd(5)} ${[d.damage, d.component, d.face].filter(Boolean).join(', ')}: ${d.status}` +
        (d.note ? `\n        “${d.note}”` : ''),
    ),
    '',
    `Sealed record, handover ${r.record.position} of ${r.record.chainLength} in the container's chain:`,
    `  SHA-256   ${r.record.hash}`,
    `  previous  ${r.record.previousHash}`,
    r.record.verified
      ? '  Checked when this receipt was made: the chain verifies and holds this hash.'
      : '  WARNING: the chain did not verify, or does not hold this hash. Ask the terminal.',
    '',
    'To check it later:',
    ...howToCheck(r).map((line) => `  ${line}`),
    '',
    `EIR:     ${r.links.receipt}`,
    `CODECO:  ${r.links.codeco}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function receiptHtml(r: Receipt): string {
  const e = escapeHtml;
  const heading = `${r.movement.charAt(0).toUpperCase()}${r.movement.slice(1)}`;
  const row = (label: string, value: string) => `<tr><th>${e(label)}</th><td>${value}</td></tr>`;
  const damage =
    r.damage.length === 0
      ? '<p>None recorded.</p>'
      : `<table class="damage"><thead><tr><th>Location</th><th>Damage</th><th>Status</th></tr></thead><tbody>${r.damage
          .map(
            (d) =>
              `<tr><td><code>${e(d.locationCode)}</code></td><td>${e([d.damage, d.component, d.face].filter(Boolean).join(', '))}${d.note ? `<br><small>“${e(d.note)}”</small>` : ''}</td><td>${e(d.status)}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(`${heading} receipt ${r.container.number}`)}</title>
<style>
  body { font: 15px/1.45 system-ui, sans-serif; max-width: 40rem; margin: 1.5rem auto; padding: 0 1rem; color: #111; }
  h1 { font-size: 1.3rem; margin-bottom: .2rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; }
  th, td { text-align: left; vertical-align: top; padding: .3rem .5rem; border-bottom: 1px solid #ddd; }
  th { width: 9rem; font-weight: 600; }
  .damage th { width: auto; }
  code { font-family: ui-monospace, monospace; word-break: break-all; }
  .ok { color: #116329; } .warn { color: #a40e26; font-weight: 600; }
  @media print { a { color: inherit; } }
</style>
</head>
<body>
<h1>${e(heading)} receipt: ${e(containerName(r.container.number))}${r.container.sizeTypeCode ? ` (${e(r.container.sizeTypeCode)})` : ''}</h1>
<table>
${row('Place', e(r.place))}
${row('Time', `${e(formatTime(r.at))} (sealed ${e(formatTime(r.sealedAt))})`)}
${row('Leg', e(r.leg))}
${row('Handed over', `${e(r.handedOverBy ?? '—')} → ${e(r.receivedBy ?? '—')}`)}
${row('Checker', e(r.checker))}
${row('Seals', e(r.seals.length > 0 ? r.seals.join(', ') : 'none recorded'))}
</table>
<h2>Damage recorded</h2>
${damage}
<h2>Sealed record</h2>
<table>
${row('Position', `handover ${r.record.position} of ${r.record.chainLength} in the container's chain`)}
${row('SHA-256', `<code>${e(r.record.hash)}</code>`)}
${row('Previous', `<code>${e(r.record.previousHash)}</code>`)}
${row('Checked', r.record.verified ? '<span class="ok">The chain verified and held this hash when this receipt was made.</span>' : '<span class="warn">The chain did not verify, or does not hold this hash. Ask the terminal.</span>')}
</table>
<p><strong>To check it later:</strong> ${e(howToCheck(r).join(' '))}</p>
<p>EIR: <a href="${e(r.links.receipt)}">${e(r.links.receipt)}</a><br>
CODECO: <a href="${e(r.links.codeco)}">${e(r.links.codeco)}</a></p>
</body>
</html>
`;
}
