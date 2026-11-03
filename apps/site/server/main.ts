/**
 * Starts the site server: reads the configuration, opens the waitlist
 * database and serves the built site. Nothing else reads the environment.
 *
 *   node server/main.ts      (npm start --workspace @plomba/site)
 */

import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { createSiteApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { clientKey, RateLimiter } from './rate-limit.ts';
import { WaitlistStore } from './store.ts';

/** Five sign-ups per address per ten minutes is plenty for people, and little for a bot. */
const RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 } as const;

function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  return getConnInfo(c).remote.address ?? 'unknown';
}

function main(): void {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }

  const store = WaitlistStore.open(config.waitlistDb);
  const limiter = new RateLimiter(RATE_LIMIT);
  // Forget addresses once their window has passed, even when nobody posts.
  const sweeper = setInterval(() => limiter.sweep(), 60_000);
  sweeper.unref();

  const app = createSiteApp({
    publicDir: config.publicDir,
    notFoundHtml: config.notFoundHtml,
    render: config.render,
    store,
    limiter,
    clientOf: (c) => clientKey(clientAddress(c, config.trustProxy)),
    onError: (error) => console.error('Request failed:', error),
  });

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(
      `Plomba site on http://${config.host}:${info.port} (waitlist: ${config.waitlistDb})`,
    );
  });

  const shutdown = () => {
    clearInterval(sweeper);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
