/** The site server's settings, from the environment, checked at startup. */

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { RenderContext } from '../src/layout.ts';
import { DEFAULT_DIST_DIR, outputPaths } from '../src/output.ts';

const EnvSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** The SQLite database of waitlist leads. Mount its folder as a volume. */
  WAITLIST_DB: z.string().min(1).default('./data/waitlist.db'),
  /** The output of `npm run build`. */
  SITE_DIST_DIR: z.string().min(1).default(DEFAULT_DIST_DIR),
  /**
   * Behind a reverse proxy, every request comes from the proxy. Set this to
   * take the client's address from the last X-Forwarded-For entry instead,
   * the one the proxy added.
   */
  TRUST_PROXY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
});

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly waitlistDb: string;
  readonly trustProxy: boolean;
  readonly publicDir: string;
  readonly notFoundHtml: string;
  readonly render: RenderContext;
}

export class ConfigError extends Error {}

const RenderContextSchema = z.object({
  origin: z.url(),
  assets: z.object({
    stylesheet: z.string(),
    waitlistScript: z.string(),
    preloadFonts: z.array(z.string()),
  }),
  sprite: z.string(),
});

/** Reads the environment and the built site. Throws ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const out = outputPaths(parsed.data.SITE_DIST_DIR);
  let render: RenderContext;
  let notFoundHtml: string;
  try {
    render = RenderContextSchema.parse(JSON.parse(readFileSync(out.renderContext, 'utf8')));
    notFoundHtml = readFileSync(out.notFoundPage, 'utf8');
  } catch (error) {
    throw new ConfigError(
      `No built site in ${parsed.data.SITE_DIST_DIR}. Run \`npm run build --workspace @plomba/site\` first.`,
      { cause: error },
    );
  }
  return {
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    waitlistDb: parsed.data.WAITLIST_DB,
    trustProxy: parsed.data.TRUST_PROXY,
    publicDir: out.publicDir,
    notFoundHtml,
    render,
  };
}
