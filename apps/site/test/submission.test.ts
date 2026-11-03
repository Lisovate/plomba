import { describe, expect, it } from 'vitest';
import { isHoneypotFilled, parseSubmission } from '../server/submission.ts';
import { LIMITS } from '../src/waitlist.ts';

const VALID = {
  name: 'Anna Nowak',
  company: 'Port Łódź',
  role: 'terminal-depot',
  email: 'anna@example.com',
  message: 'We check 200 containers a day.',
  consent: 'yes',
};

const issuesOf = (input: Record<string, unknown>) => {
  const result = parseSubmission(input);
  return result.ok ? [] : result.issues;
};

describe('waitlist submissions', () => {
  it('accepts a complete form', () => {
    expect(parseSubmission(VALID)).toEqual({
      ok: true,
      lead: {
        name: 'Anna Nowak',
        company: 'Port Łódź',
        role: 'terminal-depot',
        email: 'anna@example.com',
        message: 'We check 200 containers a day.',
      },
    });
  });

  it('trims every field and stores an empty message as none', () => {
    const result = parseSubmission({
      ...VALID,
      name: '  Anna  ',
      email: ' anna@example.com ',
      message: '   ',
    });
    expect(result).toMatchObject({
      ok: true,
      lead: { name: 'Anna', email: 'anna@example.com', message: null },
    });
  });

  it('takes the message as optional and consent as true from JSON', () => {
    const { message: _, ...rest } = VALID;
    expect(parseSubmission({ ...rest, consent: true })).toMatchObject({
      ok: true,
      lead: { message: null },
    });
  });

  it('names every missing field once, in a sentence a person can act on', () => {
    expect(issuesOf({})).toEqual([
      { path: 'name', message: 'Enter your name' },
      { path: 'company', message: 'Enter your company' },
      { path: 'role', message: 'Choose what kind of company yours is' },
      { path: 'email', message: 'Enter your email address' },
      { path: 'consent', message: 'Tick the box so we may store your details' },
    ]);
  });

  it('rejects blank names, unknown roles and malformed email addresses', () => {
    expect(issuesOf({ ...VALID, name: '   ' }).map((i) => i.path)).toEqual(['name']);
    expect(issuesOf({ ...VALID, role: 'pirate' }).map((i) => i.path)).toEqual(['role']);
    for (const email of ['anna', 'anna@', 'anna@example', 'anna example.com']) {
      expect(issuesOf({ ...VALID, email })).toEqual([
        { path: 'email', message: 'Enter an email address like name@company.com' },
      ]);
    }
  });

  it('requires consent to be given', () => {
    for (const consent of [undefined, '', 'no', false]) {
      expect(issuesOf({ ...VALID, consent }).map((i) => i.path)).toEqual(['consent']);
    }
  });

  it('enforces the same length limits as the form', () => {
    expect(issuesOf({ ...VALID, name: 'x'.repeat(LIMITS.name) })).toEqual([]);
    expect(issuesOf({ ...VALID, name: 'x'.repeat(LIMITS.name + 1) }).map((i) => i.path)).toEqual([
      'name',
    ]);
    expect(
      issuesOf({ ...VALID, message: 'x'.repeat(LIMITS.message + 1) }).map((i) => i.path),
    ).toEqual(['message']);
  });

  it('rejects values that are not text, such as an uploaded file', () => {
    expect(issuesOf({ ...VALID, company: new File(['x'], 'x.txt') }).map((i) => i.path)).toEqual([
      'company',
    ]);
  });

  it('drops fields it does not know', () => {
    const result = parseSubmission({ ...VALID, admin: 'true' });
    expect(result.ok && 'admin' in result.lead).toBe(false);
  });
});

describe('the honeypot', () => {
  it('is empty when a person sends the form', () => {
    expect(isHoneypotFilled(VALID)).toBe(false);
    expect(isHoneypotFilled({ ...VALID, website: '' })).toBe(false);
    expect(isHoneypotFilled({ ...VALID, website: '   ' })).toBe(false);
  });

  it('catches a bot that fills in every field', () => {
    expect(isHoneypotFilled({ ...VALID, website: 'https://spam.example' })).toBe(true);
    expect(isHoneypotFilled({ ...VALID, website: 1 })).toBe(true);
  });
});
