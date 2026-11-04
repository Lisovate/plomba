import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, chainHash } from '@plomba/core';

/** Recreate an earlier writer's record before another record is appended to it. */
export async function useLegacyRecord(db: DatabaseSync, id: string, version: 1 | 2) {
  const row = db.prepare('SELECT record, previous_hash FROM handovers WHERE id = ?').get(id) as {
    record: string;
    previous_hash: string;
  };
  const content = JSON.parse(row.record);
  content.version = version;
  delete content.videos;
  if (version === 1) {
    delete content.notInspected;
    // The first version 1 writer predates traced damage outlines too.
    for (const mark of content.marks) delete mark.outline;
    delete content.handover.transportMode;
    delete content.handover.vehicleId;
  }
  const record = canonicalJson(content);
  const hash = await chainHash(row.previous_hash, content);
  db.prepare('UPDATE handovers SET record = ?, hash = ? WHERE id = ?').run(record, hash, id);
}
