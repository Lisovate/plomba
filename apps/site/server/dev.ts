/**
 * Development: builds the site, then serves it. `npm run dev` reruns this on
 * every change under src/, server/ and public/.
 */

import { buildSite } from '../src/build.ts';
import { DEFAULT_DIST_DIR } from '../src/output.ts';

await buildSite({
  distDir: process.env.SITE_DIST_DIR ?? DEFAULT_DIST_DIR,
  origin: process.env.SITE_URL ?? `http://localhost:${process.env.PORT ?? '8080'}`,
});
await import('./main.ts');
