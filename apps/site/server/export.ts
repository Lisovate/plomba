/**
 * Prints the waitlist as CSV, for the operator. There is no web admin.
 *
 *   node server/export.ts > leads.csv              (reads WAITLIST_DB, default ./data/waitlist.db)
 *   node server/export.ts /data/waitlist.db > leads.csv
 */

import { existsSync } from 'node:fs';
import { leadsToCsv } from './csv.ts';
import { WaitlistStore } from './store.ts';

const path = process.argv[2] ?? process.env.WAITLIST_DB ?? './data/waitlist.db';

if (!existsSync(path)) {
  console.error(`No waitlist database at ${path}. Pass its path, or set WAITLIST_DB.`);
  process.exit(1);
}

const store = WaitlistStore.open(path);
try {
  process.stdout.write(leadsToCsv(store.list()));
} finally {
  store.close();
}
