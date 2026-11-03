/**
 * The short Markdown documents a claims handler reads: a claim letter to
 * the party in custody, and a note for a case filed for review. Every fact
 * in them comes from the sealed records, with the hashes and links that let
 * the other side check them.
 */

import { containerName, formatTime, markdownTable } from '../shared/format.ts';
import type { Claim, HandoverEvidence, Review } from './claims.ts';

export function claimLetter(claim: Claim): string {
  const { damage, lastClear: clear, firstRecorded: found } = claim;
  const container = containerName(claim.container.number);
  const to =
    claim.custody.length > 0
      ? claim.custody.join(', ')
      : 'the carrier of the leg (the records don’t name it; fill it in before sending)';
  const custody =
    claim.custody.length === 0
      ? ''
      : claim.custody.length === 1
        ? `, while the container was in the custody of ${claim.custody[0]}`
        : `, while the container was in the custody of ${claim.custody.join(', then ')}`;
  const between =
    claim.notInspectedBetween.length > 0
      ? `\n\nIn between, it was also handed over at ${claim.notInspectedBetween
          .map((h) => `${h.place} (${formatTime(h.startedAt)})`)
          .join(' and ')}, where this spot wasn’t photographed.`
      : '';
  const note = damage.note ? ` The checker noted: “${damage.note}”.` : '';

  return `# Claim: damage to ${container} at ${damage.locationCode}

${markdownTable(
  ['', ''],
  [
    ['Claim', claim.id],
    ['Opened', formatTime(claim.openedAt)],
    ['To', to],
    [
      'Container',
      `${container}${claim.container.sizeTypeCode ? `, ${claim.container.sizeTypeCode}` : ''}`,
    ],
    ['Damage', `${damage.description}, at ${damage.locationCode}`],
  ],
)}

At ${clear.place} on ${formatTime(clear.startedAt)} (${clear.leg}), the handover's sealed record has location ${damage.locationCode} photographed, with no damage there.

At ${found.place} on ${formatTime(found.startedAt)} (${found.leg}), the sealed record shows new damage at ${damage.locationCode}: ${damage.description}.${note}${between}

The damage therefore happened between these two handovers${custody}. We hold you liable for it and ask you to acknowledge this claim.

## Evidence

${evidenceTable([
  ['Last clean', clear],
  ['First recorded', found],
])}

Both records are links of the container's SHA-256 hash chain, which ${claim.chain.verified ? 'verified' : 'did not verify'} (${claim.chain.length} sealed records) when this claim was opened. Changing either record would change its hash and break the chain. The container's history: ${claim.container.link}
`;
}

const REASONS: Readonly<Record<Review['reason'], string>> = {
  'recorded-nearby': 'Damage recorded on the same spot earlier',
  'not-inspected': 'No earlier photo of the spot',
  changed: 'Known damage, marked as changed',
  unverified: 'The records do not verify',
};

export function reviewNote(review: Review): string {
  const container = containerName(review.container.number);
  return `# For review: ${container}, ${review.damage.description} at ${review.damage.locationCode}

**${REASONS[review.reason]}.** ${review.explanation}
${review.damage.note ? `\nThe checker noted: “${review.damage.note}”.\n` : ''}
${evidenceTable([
  ['This handover', review.handover],
  ...review.related.map(
    (h, i) => [review.related.length > 1 ? `Earlier (${i + 1})` : 'Earlier', h] as const,
  ),
])}

Case ${review.id}, opened ${formatTime(review.openedAt)}. The container's history: ${review.container.link}
`;
}

function evidenceTable(columns: readonly (readonly [string, HandoverEvidence])[]): string {
  const row = (label: string, value: (h: HandoverEvidence) => string) => [
    label,
    ...columns.map(([, h]) => value(h)),
  ];
  return markdownTable(
    ['', ...columns.map(([title]) => title)],
    [
      row('Place', (h) => h.place),
      row('Time', (h) => formatTime(h.startedAt)),
      row('Leg', (h) => h.leg),
      row(
        'Handed over by → received by',
        (h) => `${h.handedOverBy ?? '—'} → ${h.receivedBy ?? '—'}`,
      ),
      row('Checker', (h) => h.checker),
      row('Sealed record (SHA-256)', (h) => (h.recordHash ? `\`${h.recordHash}\`` : 'not sealed')),
      row('Position in the chain', (h) => (h.chainPosition ? String(h.chainPosition) : '—')),
      row('EIR', (h) => h.links.receipt),
      row('CODECO', (h) => h.links.codeco),
    ],
  );
}
