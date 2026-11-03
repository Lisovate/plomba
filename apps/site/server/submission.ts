/**
 * Validates a waitlist submission, from a JSON body or a posted form. The
 * field names and limits are the form's own (src/waitlist.ts).
 */

import { z } from 'zod';
import { type FieldName, HONEYPOT_FIELD, LIMITS, ROLES, type Role } from '../src/waitlist.ts';

export interface Lead {
  readonly name: string;
  readonly company: string;
  readonly role: Role;
  readonly email: string;
  readonly message: string | null;
}

export interface FieldIssue {
  readonly path: FieldName;
  readonly message: string;
}

export type SubmissionResult =
  | { readonly ok: true; readonly lead: Lead }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

const ROLE_VALUES = ROLES.map((r) => r.value) as [Role, ...Role[]];

const requiredText = (missing: string, max: number, tooLong: string) =>
  z.string({ error: missing }).trim().min(1, { error: missing }).max(max, { error: tooLong });

/** A ticked checkbox posts "yes" (or "on"); JSON may send true. */
export const isTicked = (value: unknown): boolean =>
  value === true || value === 'yes' || value === 'on';

const SubmissionSchema = z.object({
  name: requiredText(
    'Enter your name',
    LIMITS.name,
    `Keep your name under ${LIMITS.name} characters`,
  ),
  company: requiredText(
    'Enter your company',
    LIMITS.company,
    `Keep the company name under ${LIMITS.company} characters`,
  ),
  role: z.enum(ROLE_VALUES, { error: 'Choose what kind of company yours is' }),
  email: z
    .string({ error: 'Enter your email address' })
    .trim()
    .max(LIMITS.email, { error: 'That email address is too long' })
    .pipe(z.email({ error: 'Enter an email address like name@company.com' })),
  message: z
    .string({ error: 'The message must be text' })
    .trim()
    .max(LIMITS.message, { error: `Keep the message under ${LIMITS.message} characters` })
    .optional()
    .transform((value) => value || null),
  consent: z.preprocess(
    isTicked,
    z.literal(true, { error: 'Tick the box so we may store your details' }),
  ),
});

export function parseSubmission(input: Readonly<Record<string, unknown>>): SubmissionResult {
  const parsed = SubmissionSchema.safeParse(input);
  if (parsed.success) {
    const { consent: _, ...lead } = parsed.data;
    return { ok: true, lead };
  }
  const issues: FieldIssue[] = [];
  for (const issue of parsed.error.issues) {
    const path = String(issue.path[0] ?? '') as FieldName;
    // One message per field: the first problem is the one to fix.
    if (!issues.some((i) => i.path === path)) issues.push({ path, message: issue.message });
  }
  return { ok: false, issues };
}

/** True when the hidden field that people never see was filled in, so a bot sent the form. */
export function isHoneypotFilled(input: Readonly<Record<string, unknown>>): boolean {
  const value = input[HONEYPOT_FIELD];
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
}
