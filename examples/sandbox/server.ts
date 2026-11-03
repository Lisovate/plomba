/**
 * A Plomba installation for trying and testing the examples: the real HTTP
 * API (routes, validation, access control with an access code and API
 * tokens, the hash chain, the damage passport, CODECO), over an in-memory
 * database and the server's fake models, so it needs no Meta Model API key
 * and keeps nothing. It is the server's own `createTestApp`, served on a
 * port.
 *
 * Webhooks go through the server's real `WebhookNotifier` and
 * `describeHandoverEvent`: the same payload, signature and retries a real
 * installation sends. `createTestApp` takes no event publisher, so the
 * sandbox publishes the two events from the API's answers instead: a 201
 * from POST /api/handovers is `handover.started`, a 200 from
 * POST /api/handovers/{id}/close is `handover.sealed`.
 */

import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { HandoverSchema } from '@plomba/contracts';
import { WebhookNotifier } from '../../apps/server/src/adapters/webhooks.ts';
import type { HandoverEvent } from '../../apps/server/src/ports.ts';
import { describeHandoverEvent } from '../../apps/server/src/services/events.ts';
import type { HandoverService } from '../../apps/server/src/services/handovers.ts';
import { createTestApp, silentLogger } from '../../apps/server/test/fakes.ts';

export interface SandboxOptions {
  /** 0 (the default) picks a free port. */
  readonly port?: number;
  readonly host?: string;
  /** People's access code; with one set, other systems need an API token. */
  readonly accessCode?: string;
  /** The API token the examples send; generated when not given. */
  readonly apiToken?: string;
  readonly webhooks?: {
    readonly urls: readonly string[];
    readonly secret: string;
    /** Waits before each retry; the server's default is 1 s, 10 s, 60 s. */
    readonly retryDelaysMs?: readonly number[];
  };
}

export interface Sandbox {
  /** The installation's address, e.g. http://127.0.0.1:41234. */
  readonly url: string;
  readonly token: string;
  readonly accessCode: string;
  /** The server's handover service, for tests that build webhook payloads themselves. */
  readonly handovers: HandoverService;
  /** Resolves when every webhook delivery so far has succeeded or given up. */
  deliveries(): Promise<void>;
  close(): Promise<void>;
}

export async function startSandbox(options: SandboxOptions = {}): Promise<Sandbox> {
  const token = options.apiToken ?? randomBytes(24).toString('hex');
  const accessCode = options.accessCode ?? randomBytes(12).toString('hex');
  const { app, service } = createTestApp({
    accessCode,
    apiTokens: [{ name: 'examples', token }],
  });

  let url = '';
  const notifier =
    options.webhooks && options.webhooks.urls.length > 0
      ? new WebhookNotifier({
          urls: options.webhooks.urls,
          secret: options.webhooks.secret,
          describe: (event, id) => describeHandoverEvent(service, event, { id, publicUrl: url }),
          logger: silentLogger,
          ...(options.webhooks.retryDelaysMs
            ? { retryDelaysMs: options.webhooks.retryDelaysMs }
            : {}),
        })
      : undefined;
  const pending = new Set<Promise<void>>();

  const fetchAndPublish = async (request: Request): Promise<Response> => {
    const response = await app.fetch(request);
    if (notifier) {
      const event = await eventFor(request, response);
      if (event) {
        const delivery = notifier.deliver(event).finally(() => pending.delete(delivery));
        pending.add(delivery);
      }
    }
    return response;
  };

  const port = options.port ?? 0;
  const hostname = options.host ?? '127.0.0.1';
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: fetchAndPublish, port, hostname }, () => resolve(s));
    s.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${port} on ${hostname} is in use; choose another with --port`)
          : error,
      ),
    );
  });
  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  url = `http://${host}:${address.port}`;

  return {
    url,
    token,
    accessCode,
    handovers: service,
    async deliveries() {
      while (pending.size > 0) await Promise.all(pending);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** The event a successful API answer stands for, as the handover service would publish it. */
async function eventFor(request: Request, response: Response): Promise<HandoverEvent | undefined> {
  if (request.method !== 'POST') return undefined;
  const path = new URL(request.url).pathname;
  const started = path === '/api/handovers' && response.status === 201;
  const sealed = /^\/api\/handovers\/[^/]+\/close$/.test(path) && response.status === 200;
  if (!started && !sealed) return undefined;
  const handover = HandoverSchema.parse(await response.clone().json());
  return {
    type: started ? 'handover.started' : 'handover.sealed',
    handoverId: handover.id,
    containerNumber: handover.containerNumber,
    occurredAt: (started ? handover.startedAt : handover.closedAt) ?? new Date().toISOString(),
  };
}
