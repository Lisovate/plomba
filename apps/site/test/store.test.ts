import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { leadsToCsv, toCsv } from '../server/csv.ts';
import { WaitlistStore } from '../server/store.ts';
import type { Lead } from '../server/submission.ts';

const ANNA: Lead = {
  name: 'Anna Nowak',
  company: 'Port Łódź',
  role: 'terminal-depot',
  email: 'anna@example.com',
  message: null,
};

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the waitlist store', () => {
  it('stores a lead with the time it was given', () => {
    const store = WaitlistStore.open(':memory:');
    store.save(ANNA, new Date('2026-11-03T10:00:00Z'));
    expect(store.list()).toEqual([
      {
        id: 1,
        ...ANNA,
        consentedAt: '2026-11-03T10:00:00.000Z',
        createdAt: '2026-11-03T10:00:00.000Z',
        updatedAt: '2026-11-03T10:00:00.000Z',
      },
    ]);
  });

  it('keeps one entry per email address, whatever its case, updated by the latest sign-up', () => {
    const store = WaitlistStore.open(':memory:');
    store.save(ANNA, new Date('2026-11-03T10:00:00Z'));
    store.save(
      { ...ANNA, email: 'ANNA@example.com', company: 'Łódź Terminal', message: 'Hello' },
      new Date('2026-11-04T10:00:00Z'),
    );
    store.save({ ...ANNA, email: 'jan@example.com' }, new Date('2026-11-05T10:00:00Z'));

    const [anna, jan] = store.list();
    expect(store.list()).toHaveLength(2);
    expect(anna).toMatchObject({
      email: 'anna@example.com',
      company: 'Łódź Terminal',
      message: 'Hello',
      createdAt: '2026-11-03T10:00:00.000Z',
      updatedAt: '2026-11-04T10:00:00.000Z',
      consentedAt: '2026-11-04T10:00:00.000Z',
    });
    expect(jan?.email).toBe('jan@example.com');
  });

  it('deletes an entry on request, matching the email address in any case', () => {
    const store = WaitlistStore.open(':memory:');
    store.save(ANNA, new Date('2026-11-03T10:00:00Z'));
    expect(store.delete(' Anna@Example.com ')).toBe(true);
    expect(store.delete('anna@example.com')).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('creates the database and its folder, and keeps leads across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plomba-waitlist-'));
    temporary.push(dir);
    const path = join(dir, 'nested', 'waitlist.db');

    const first = WaitlistStore.open(path);
    first.save(ANNA, new Date('2026-11-03T10:00:00Z'));
    first.close();

    const second = WaitlistStore.open(path);
    expect(second.list().map((lead) => lead.email)).toEqual(['anna@example.com']);
    second.close();
  });
});

describe('the CSV export', () => {
  it('quotes cells with commas, quotes and line breaks', () => {
    expect(toCsv([['plain', 'a,b', 'say "hi"', 'two\nlines']])).toBe(
      'plain,"a,b","say ""hi""","two\nlines"\r\n',
    );
  });

  it('stops spreadsheets from running cells as formulas', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', '-1', '@SUM(A1)', 'safe']])).toBe(
      `"'=HYPERLINK(""x"")",'+1,'-1,'@SUM(A1),safe\r\n`,
    );
  });

  it('writes one row per lead under a header, with the role spelled out', () => {
    const store = WaitlistStore.open(':memory:');
    store.save({ ...ANNA, message: 'Gate 3, mornings' }, new Date('2026-11-03T10:00:00Z'));
    const [header, row] = leadsToCsv(store.list()).split('\r\n');
    expect(header).toBe('Signed up,Updated,Name,Company,Role,Email,Message,Agreed to privacy note');
    expect(row).toBe(
      '2026-11-03T10:00:00.000Z,2026-11-03T10:00:00.000Z,Anna Nowak,Port Łódź,Terminal or depot,anna@example.com,"Gate 3, mornings",2026-11-03T10:00:00.000Z',
    );
  });
});
