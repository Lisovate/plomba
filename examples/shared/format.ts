/**
 * Words for what Plomba records, as people read them on a claim, a receipt
 * or a fleet report: times in UTC, the leg of a handover, CEDEX codes with
 * their meaning, and container and wagon numbers as painted.
 */

import type { Direction, Face, Handover } from '@plomba/contracts';
import {
  COMPONENT_CODES,
  DAMAGE_CODES,
  FACE_NAMES,
  formatContainerNumber,
  formatWagonNumber,
  isComponentCode,
  isDamageCode,
} from '@plomba/core';

/** `2026-10-28 08:00 UTC`, or a dash when there is no time. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function directionName(direction: Direction): string {
  return direction === 'in' ? 'gate in' : 'gate out';
}

/** `truck EL 4K217`, `wagon 33 51 4556 012-4`, or null when the handover doesn't say. */
export function vehicleName(
  handover: Pick<Handover, 'transportMode' | 'vehicleId'>,
): string | null {
  if (!handover.vehicleId) return null;
  if (handover.transportMode === 'rail') return `wagon ${formatWagonNumber(handover.vehicleId)}`;
  return `${handover.transportMode === 'road' ? 'truck' : 'vehicle'} ${handover.vehicleId}`;
}

/** `gate out, by road, truck EL 4K217`: which way the container went, and on what. */
export function legName(
  handover: Pick<Handover, 'direction' | 'transportMode' | 'vehicleId'>,
): string {
  const parts = [directionName(handover.direction)];
  if (handover.transportMode) parts.push(`by ${handover.transportMode}`);
  const vehicle = vehicleName(handover);
  if (vehicle) parts.push(vehicle);
  return parts.join(', ');
}

/** `Dent (DT)`. */
export function damageName(code: string | null): string {
  if (!code) return 'Damage (not coded)';
  return isDamageCode(code) ? `${DAMAGE_CODES[code]} (${code})` : `Damage code ${code}`;
}

/** `Panel (PAA)`, or null when no component was coded. */
export function componentName(code: string | null): string | null {
  if (!code) return null;
  return isComponentCode(code) ? `${COMPONENT_CODES[code]} (${code})` : `Component code ${code}`;
}

export function faceName(face: Face): string {
  return FACE_NAMES[face].toLowerCase();
}

/** `PLBU 400004 3`, as painted on the doors. */
export function containerName(number: string): string {
  return formatContainerNumber(number);
}

/** The first characters of a SHA-256, for tables; the full hash goes in the files. */
export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 12)}…` : '—';
}

/** A Markdown table; pipes and line breaks in cells are escaped. */
export function markdownTable(
  head: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const cell = (text: string) => text.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
