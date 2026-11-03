/**
 * Deletes someone's waitlist entry, when they ask (see the privacy note).
 *
 *   node server/delete-lead.ts anna@example.com      (reads WAITLIST_DB, default ./data/waitlist.db)
 */

import { existsSync } from 'node:fs';
import { WaitlistStore } from './store.ts';

const email = process.argv[2];
const path = process.env.WAITLIST_DB ?? './data/waitlist.db';

if (!email) {
  console.error('Usage: node server/delete-lead.ts <email address>');
  process.exit(2);
}
if (!existsSync(path)) {
  console.error(`No waitlist database at ${path}. Set WAITLIST_DB.`);
  process.exit(1);
}

const store = WaitlistStore.open(path);
try {
  const deleted = store.delete(email);
  console.log(deleted ? `Deleted the entry for ${email}.` : `There is no entry for ${email}.`);
  process.exitCode = deleted ? 0 : 1;
} finally {
  store.close();
}
