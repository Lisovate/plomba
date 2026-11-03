/** CSV as RFC 4180 describes it, safe to open in a spreadsheet. */

import { roleLabel } from '../src/waitlist.ts';
import type { StoredLead } from './store.ts';

/**
 * Quotes a cell when it needs it. A cell starting with = + - @ or a control
 * character is prefixed with an apostrophe, so a spreadsheet shows it as text
 * instead of running it as a formula.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(csvCell).join(',')}\r\n`).join('');
}

const COLUMNS = [
  'Signed up',
  'Updated',
  'Name',
  'Company',
  'Role',
  'Email',
  'Message',
  'Agreed to privacy note',
];

export function leadsToCsv(leads: readonly StoredLead[]): string {
  return toCsv([
    COLUMNS,
    ...leads.map((lead) => [
      lead.createdAt,
      lead.updatedAt,
      lead.name,
      lead.company,
      roleLabel(lead.role),
      lead.email,
      lead.message ?? '',
      lead.consentedAt,
    ]),
  ]);
}
