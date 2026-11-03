/**
 * Starts the sandbox: a Plomba API with fake models and an in-memory
 * database, with one container's journey already recorded.
 *
 *   node examples/sandbox/main.ts [--port 8787] [--empty]
 *
 * Environment (all optional):
 * - PLOMBA_API_TOKEN: the token to accept (generated and printed otherwise);
 * - PLOMBA_WEBHOOK_URLS, PLOMBA_WEBHOOK_SECRET: where to send signed events, as on a real server.
 */

import { parseCommandLine, runCli, UsageError } from '../shared/cli.ts';
import { PlombaClient } from '../shared/client.ts';
import { formatTime, legName } from '../shared/format.ts';
import { recordJourney } from './journey.ts';
import { startSandbox } from './server.ts';

const USAGE = `Usage: node examples/sandbox/main.ts [--port 8787] [--host 127.0.0.1] [--empty]

  --empty   start without the recorded journey

Environment: PLOMBA_API_TOKEN (optional), PLOMBA_WEBHOOK_URLS and PLOMBA_WEBHOOK_SECRET (optional)`;

runCli(USAGE, async () => {
  const { values } = parseCommandLine({
    options: {
      port: { type: 'string', default: '8787' },
      host: { type: 'string', default: '127.0.0.1' },
      empty: { type: 'boolean', default: false },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new UsageError(`--port must be a port number, not ${values.port}`);
  }
  const urls = (process.env.PLOMBA_WEBHOOK_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const secret = process.env.PLOMBA_WEBHOOK_SECRET ?? '';
  if (urls.length > 0 && secret.length < 16) {
    throw new UsageError('Webhooks need PLOMBA_WEBHOOK_SECRET, 16 characters or more');
  }
  const token = process.env.PLOMBA_API_TOKEN?.trim();
  if (token !== undefined && token.length < 24) {
    throw new UsageError('PLOMBA_API_TOKEN must be 24 characters or more, as on a real server');
  }

  const sandbox = await startSandbox({
    port,
    host: values.host,
    ...(token ? { apiToken: token } : {}),
    ...(urls.length > 0 ? { webhooks: { urls, secret } } : {}),
  });
  console.log(`Plomba sandbox on ${sandbox.url} (fake models, in-memory database)\n`);
  console.log(`  export PLOMBA_URL=${sandbox.url}`);
  console.log(`  export PLOMBA_API_TOKEN=${sandbox.token}\n`);
  if (urls.length > 0) console.log(`Webhooks go to ${urls.join(', ')}\n`);

  if (!values.empty) {
    const client = new PlombaClient({ baseUrl: sandbox.url, token: sandbox.token });
    const journey = await recordJourney(client);
    console.log('Recorded (invented data):');
    for (const h of Object.values(journey.handovers)) {
      const state = h.seal ? `sealed #${h.seal.sequence + 1}` : 'open';
      console.log(`  ${h.id}  ${h.containerNumber}  ${h.place}, ${legName(h)}  ${state}`);
    }
    console.log(
      `\nTimes are the sandbox's clock: ${formatTime(journey.handovers.gdynia.startedAt)} on.`,
    );
    await sandbox.deliveries();
  }
  console.log('Ctrl+C to stop.');

  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await sandbox.close();
  return 0;
});
