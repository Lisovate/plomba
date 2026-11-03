/**
 * Waitlist leads in SQLite (node:sqlite, no native modules). One row per
 * email address: signing up again updates the entry rather than adding one.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Role } from '../src/waitlist.ts';
import type { Lead } from './submission.ts';

export interface StoredLead extends Lead {
  readonly id: number;
  /** When the visitor last agreed to the privacy note, ISO 8601. */
  readonly consentedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Applied in order; the version lives in `PRAGMA user_version`. Never edit a released one. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE leads (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    company       TEXT NOT NULL,
    role          TEXT NOT NULL,
    message       TEXT,
    consented_at  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  ) STRICT;`,
];

function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  for (const [index, sql] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

interface LeadRow {
  id: number;
  email: string;
  name: string;
  company: string;
  role: string;
  message: string | null;
  consented_at: string;
  created_at: string;
  updated_at: string;
}

export class WaitlistStore {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Opens the database at `path`, creating it and its folder if needed. `:memory:` for tests. */
  static open(path: string): WaitlistStore {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
    return new WaitlistStore(db);
  }

  /** Adds a lead, or updates the one with the same email address. */
  save(lead: Lead, at: Date): void {
    const now = at.toISOString();
    this.#db
      .prepare(
        `INSERT INTO leads (email, name, company, role, message, consented_at, created_at, updated_at)
         VALUES (:email, :name, :company, :role, :message, :now, :now, :now)
         ON CONFLICT (email) DO UPDATE SET
           name = excluded.name,
           company = excluded.company,
           role = excluded.role,
           message = excluded.message,
           consented_at = excluded.consented_at,
           updated_at = excluded.updated_at`,
      )
      .run({ ...lead, now });
  }

  /** Every lead, oldest first. */
  list(): StoredLead[] {
    const rows = this.#db
      .prepare('SELECT * FROM leads ORDER BY created_at, id')
      .all() as unknown as LeadRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      company: row.company,
      role: row.role as Role,
      email: row.email,
      message: row.message,
      consentedAt: row.consented_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Deletes the entry for an email address, whatever its case. Says whether there was one. */
  delete(email: string): boolean {
    const { changes } = this.#db.prepare('DELETE FROM leads WHERE email = ?').run(email.trim());
    return Number(changes) > 0;
  }

  close(): void {
    this.#db.close();
  }
}
