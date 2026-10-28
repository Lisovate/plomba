import { DatabaseSync } from 'node:sqlite';
import type { TransactionRunner } from '../../ports.ts';
import { MIGRATIONS } from './migrations.ts';

/** Opens (and migrates) the database. Use `:memory:` for tests. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Applies pending migrations in order; the schema version lives in `PRAGMA user_version`. */
export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (const [index, sql] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (version <= row.user_version) continue;
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

export function createTransactionRunner(db: DatabaseSync): TransactionRunner {
  let depth = 0;
  return <T>(fn: () => T): T => {
    // Nested calls join the outer transaction.
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      depth--;
    }
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}
