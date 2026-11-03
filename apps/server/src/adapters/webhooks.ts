/**
 * Delivers handover events to other systems' endpoints as signed JSON POSTs,
 * in the style of Stripe's webhooks: the `Plomba-Signature` header carries
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, so a receiver can
 * check both who sent it and that it isn't a replay. Failed deliveries are
 * retried with backoff; none of this ever blocks or fails the request that
 * caused the event.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { WebhookEvent } from '@plomba/contracts';
import type { Logger } from 'pino';
import type { HandoverEvent } from '../ports.ts';

export const SIGNATURE_HEADER = 'Plomba-Signature';

/** The signature header value for a body sent at `timestamp` (unix seconds). */
export function sign(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

/**
 * Checks a signature header the way a receiver should: the MAC must match
 * and the timestamp must be recent, so an old delivery can't be replayed.
 */
export function verify(
  secret: string,
  header: string,
  body: string,
  options: { readonly now?: number; readonly toleranceSeconds?: number } = {},
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=', 2) as [string, string]),
  );
  const timestamp = Number(parts.t);
  const sent = parts.v1;
  if (!Number.isFinite(timestamp) || !sent) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) return false;
  const expected = sign(secret, timestamp, body).split('v1=')[1] ?? '';
  return (
    expected.length === sent.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sent))
  );
}

export interface WebhookNotifierOptions {
  readonly urls: readonly string[];
  readonly secret: string;
  /** Builds the payload for an event, with its id. */
  readonly describe: (event: HandoverEvent, id: string) => Promise<WebhookEvent>;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  /** Waits before each retry; three retries by default. */
  readonly retryDelaysMs?: readonly number[];
  readonly timeoutMs?: number;
}

export class WebhookNotifier {
  readonly #o: WebhookNotifierOptions;

  constructor(options: WebhookNotifierOptions) {
    this.#o = options;
  }

  /** Delivers one event to every endpoint; resolves when all have succeeded or given up. */
  async deliver(event: HandoverEvent): Promise<void> {
    const id = randomUUID();
    const body = JSON.stringify(await this.#o.describe(event, id));
    await Promise.all(this.#o.urls.map((url) => this.#send(url, event, id, body)));
  }

  async #send(url: string, event: HandoverEvent, id: string, body: string): Promise<void> {
    const fetchFn = this.#o.fetch ?? fetch;
    const delays = this.#o.retryDelaysMs ?? [1_000, 10_000, 60_000];
    for (let attempt = 0; ; attempt++) {
      let status: number | string;
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Plomba-Webhooks/1',
            'plomba-event': event.type,
            'plomba-delivery': id,
            [SIGNATURE_HEADER.toLowerCase()]: sign(
              this.#o.secret,
              Math.floor(Date.now() / 1000),
              body,
            ),
          },
          body,
          signal: AbortSignal.timeout(this.#o.timeoutMs ?? 10_000),
        });
        if (response.ok) {
          this.#o.logger.info({ url, event: event.type, id, attempt }, 'Webhook delivered');
          return;
        }
        status = response.status;
      } catch (error) {
        status = (error as Error).name;
      }
      const delay = delays[attempt];
      if (delay === undefined) {
        this.#o.logger.error({ url, event: event.type, id, status }, 'Webhook gave up');
        return;
      }
      this.#o.logger.warn({ url, event: event.type, id, status, attempt }, 'Webhook retrying');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
