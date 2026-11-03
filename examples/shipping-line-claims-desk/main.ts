/**
 * The claims desk's webhook receiver: point a Plomba installation's
 * PLOMBA_WEBHOOK_URLS at it, and it opens a claim file for damage that
 * appeared between two handovers.
 */

import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { WebhookEventSchema } from '@plomba/contracts';
import { clientFromEnv, parseCommandLine, runCli, UsageError } from '../shared/cli.ts';
import { createClaimsDesk } from './receiver.ts';

const USAGE = `Usage:
  node examples/shipping-line-claims-desk/main.ts [--port 8790] [--host 127.0.0.1] [--out ./claims-desk] [--tolerance 300]
  node examples/shipping-line-claims-desk/main.ts --replay <event.json>... [--out ./claims-desk]

  --port, --host   where to listen for webhooks
  --out            where claim files go (claims/, review/, failed/)
  --tolerance      how old a signature may be, in seconds
  --replay         process saved events instead of listening; replayed files in failed/ are removed

Environment:
  PLOMBA_WEBHOOK_SECRET   the installation's webhook secret (required to listen)
  PLOMBA_URL              the installation, for each container's history (default http://localhost:8787)
  PLOMBA_API_TOKEN        an API token for it`;

runCli(USAGE, async () => {
  const { values, positionals } = parseCommandLine({
    options: {
      port: { type: 'string', default: '8790' },
      host: { type: 'string', default: '127.0.0.1' },
      out: { type: 'string', default: './claims-desk' },
      tolerance: { type: 'string', default: '300' },
      replay: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const outDir = resolve(values.out);
  const plomba = clientFromEnv();

  if (values.replay) {
    if (positionals.length === 0) throw new UsageError('--replay needs one or more event files');
    const desk = createClaimsDesk({ secret: '', outDir, plomba });
    const failedDir = join(outDir, 'failed') + sep;
    let failed = 0;
    for (const file of positionals) {
      const event = WebhookEventSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (!(await desk.process(event))) failed++;
      // The desk saved it there when it failed; done now.
      else if (resolve(file).startsWith(failedDir)) await rm(file);
    }
    return failed > 0 ? 1 : 0;
  }

  const secret = process.env.PLOMBA_WEBHOOK_SECRET ?? '';
  if (secret.length < 16) {
    throw new UsageError('Set PLOMBA_WEBHOOK_SECRET to the webhook secret (16+ characters)');
  }
  const port = Number(values.port);
  const toleranceSeconds = Number(values.tolerance);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new UsageError(`--port must be a port number, not ${values.port}`);
  }
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0) {
    throw new UsageError(`--tolerance must be a number of seconds, not ${values.tolerance}`);
  }

  const desk = createClaimsDesk({ secret, outDir, plomba, toleranceSeconds });
  const server = createServer(desk.handle);
  await new Promise<void>((done, fail) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      fail(
        error.code === 'EADDRINUSE'
          ? new UsageError(`Port ${port} on ${values.host} is in use; choose another with --port`)
          : error,
      ),
    );
    server.listen(port, values.host, done);
  });
  const address = server.address() as AddressInfo;
  console.log(`Claims desk listening on http://${values.host}:${address.port}/`);
  console.log(`Claim files go to ${outDir}`);

  await new Promise<void>((done) => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
  console.log('Stopping: finishing the events already accepted…');
  await new Promise<void>((done) => server.close(() => done()));
  await desk.idle();
  return 0;
});
