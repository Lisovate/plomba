/** The layout of a build, shared by the builder and the server that serves it. */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where `npm run build` writes, unless told otherwise. */
export const DEFAULT_DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));

export const outputPaths = (distDir: string) => ({
  /** Served as the site's root. */
  publicDir: join(distDir, 'public'),
  /** Sent with status 404; not addressable itself. */
  notFoundPage: join(distDir, '404.html'),
  /** What the server needs to render pages with the built assets. */
  renderContext: join(distDir, 'render-context.json'),
});
