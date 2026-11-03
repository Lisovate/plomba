/**
 * The claims desk's webhook endpoint, for node:http.
 *
 * For each delivery, in this order:
 * 1. read the raw body (up to a limit);
 * 2. check `Plomba-Signature` on those bytes, refusing old timestamps (401);
 * 3. parse the event with the contracts' WebhookEventSchema (400 if it isn't one);
 * 4. skip a delivery already seen, by `Plomba-Delivery` (200, so Plomba stops retrying);
 * 5. answer 202 at once, and process `handover.sealed` events in the
 *    background, one at a time: read the container's history from the API,
 *    decide (buildClaims), and write the files.
 *
 * Answering before processing keeps the answer within Plomba's timeout
 * whatever the API or the disk is doing. An event whose processing fails is
 * saved under `failed/`, to be replayed with `--replay`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { type WebhookEvent, WebhookEventSchema } from '@plomba/contracts';
import type { PlombaClient } from '../shared/client.ts';
import { buildClaims, type ClaimsDecision } from './claims.ts';
import { claimLetter, reviewNote } from './letters.ts';
import { verifySignature } from './signature.ts';

export interface ClaimsDeskOptions {
  /** The webhook secret, the same as PLOMBA_WEBHOOK_SECRET_FILE on the server. */
  readonly secret: string;
  /** Where claim files go: `claims/`, `review/` and `failed/` inside it. */
  readonly outDir: string;
  /** For the container's history. */
  readonly plomba: PlombaClient;
  /** How old a signature may be; 5 minutes by default. */
  readonly toleranceSeconds?: number;
  /** Larger bodies are refused; 1 MB by default. */
  readonly maxBodyBytes?: number;
  readonly log?: (line: string) => void;
}

export interface ProcessedEvent {
  readonly eventId: string;
  readonly handoverId: string;
  readonly containerNumber: string;
  readonly decision: ClaimsDecision;
  /** The files written, relative to the output folder. */
  readonly files: string[];
}

export interface ClaimsDesk {
  /** The request handler: `createServer(desk.handle)`. */
  readonly handle: (request: IncomingMessage, response: ServerResponse) => void;
  /** Processes one event now, without a signature: for replaying a saved event. */
  process(event: WebhookEvent): Promise<ProcessedEvent | undefined>;
  /** Resolves when every accepted event has been processed. */
  idle(): Promise<void>;
  /** Every event processed, oldest first. */
  readonly processed: readonly ProcessedEvent[];
}

interface Answer {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** How many delivery ids to remember. Plomba retries within about 71 seconds. */
const REMEMBERED_DELIVERIES = 10_000;

export function createClaimsDesk(options: ClaimsDeskOptions): ClaimsDesk {
  const log = options.log ?? ((line: string) => console.log(line));
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const seen = new RecentIds(REMEMBERED_DELIVERIES);
  const processed: ProcessedEvent[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  async function receive(request: IncomingMessage): Promise<Answer> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'GET' && path === '/health') return { status: 200, body: { ok: true } };
    if (request.method !== 'POST') {
      return { status: 405, body: { error: 'Send events with POST' }, headers: { allow: 'POST' } };
    }

    const body = await readBody(request, maxBodyBytes);
    if (!body) {
      return { status: 413, body: { error: `Bodies are limited to ${maxBodyBytes} bytes` } };
    }

    const signature = verifySignature(options.secret, header(request, 'plomba-signature'), body, {
      ...(options.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: options.toleranceSeconds }),
    });
    if (!signature.ok) {
      log(`Refused a delivery from ${request.socket.remoteAddress}: signature ${signature.reason}`);
      return { status: 401, body: { error: `Signature ${signature.reason}` } };
    }

    const parsed = WebhookEventSchema.safeParse(parseJson(body));
    if (!parsed.success) {
      log(
        `Refused a signed delivery that isn't a Plomba event: ${parsed.error.issues[0]?.message}`,
      );
      return { status: 400, body: { error: 'Not a Plomba webhook event' } };
    }
    const event = parsed.data;
    // The header isn't signed; the id in the body is. They must agree.
    const delivery = header(request, 'plomba-delivery') ?? event.id;
    if (delivery !== event.id) {
      return { status: 400, body: { error: 'Plomba-Delivery is not the event id' } };
    }
    if (seen.has(delivery)) {
      log(`Skipped delivery ${delivery}: already received`);
      return { status: 200, body: { status: 'duplicate' } };
    }
    seen.add(delivery);
    if (event.type !== 'handover.sealed') return { status: 200, body: { status: 'ignored' } };

    queue = queue
      .then(() => processSafely(event))
      .catch((error: unknown) => log(`Lost event ${event.id}: ${error}`));
    return { status: 202, body: { status: 'accepted' } };
  }

  async function processEvent(event: WebhookEvent): Promise<ProcessedEvent> {
    const { container, handover } = event.data;
    const history = await options.plomba.containerHistory(container.number);
    const decision = buildClaims(event, history);
    const files = await save(options.outDir, decision);
    const result = {
      eventId: event.id,
      handoverId: handover.id,
      containerNumber: container.number,
      decision,
      files,
    };
    processed.push(result);
    log(
      `${container.number} at ${handover.place} (handover ${handover.id}): ` +
        `${decision.claims.length} claim(s), ${decision.reviews.length} for review, ` +
        `${decision.skipped.length} skipped${files.length > 0 ? `\n  ${files.join('\n  ')}` : ''}`,
    );
    return result;
  }

  async function processSafely(event: WebhookEvent): Promise<ProcessedEvent | undefined> {
    try {
      return await processEvent(event);
    } catch (error) {
      const file = join('failed', `${event.id}.json`);
      await mkdir(join(options.outDir, 'failed'), { recursive: true });
      await writeFile(join(options.outDir, file), JSON.stringify(event, null, 2));
      log(
        `Could not process event ${event.id}: ${error instanceof Error ? error.message : error}\n` +
          `  Saved as ${file}; replay it with --replay once the cause is fixed.`,
      );
      return undefined;
    }
  }

  return {
    handle(request, response) {
      receive(request).then(
        (answer) => reply(response, answer),
        (error: unknown) => {
          log(`Delivery failed: ${error instanceof Error ? error.message : error}`);
          reply(response, { status: 500, body: { error: 'Internal error' } });
        },
      );
    },
    process: processSafely,
    async idle() {
      let current: Promise<unknown>;
      do {
        current = queue;
        await current;
      } while (current !== queue);
    },
    processed,
  };
}

/** Writes each case as JSON (for systems) and Markdown (for people); returns the paths written. */
async function save(outDir: string, decision: ClaimsDecision): Promise<string[]> {
  const files: string[] = [];
  const write = async (folder: string, id: string, json: unknown, markdown: string) => {
    await mkdir(join(outDir, folder), { recursive: true });
    await writeFile(join(outDir, folder, `${id}.json`), `${JSON.stringify(json, null, 2)}\n`);
    await writeFile(join(outDir, folder, `${id}.md`), markdown);
    files.push(join(folder, `${id}.json`), join(folder, `${id}.md`));
  };
  for (const claim of decision.claims) await write('claims', claim.id, claim, claimLetter(claim));
  for (const review of decision.reviews) {
    await write('review', review.id, review, reviewNote(review));
  }
  return files;
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // Keep reading, so the answer can still be sent, but stop keeping it.
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  return size <= limit ? Buffer.concat(chunks) : undefined;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}

function reply(response: ServerResponse, answer: Answer): void {
  response.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
  response.end(JSON.stringify(answer.body));
}

/** The last `capacity` ids added; the oldest are forgotten first. */
class RecentIds {
  readonly #ids = new Set<string>();
  readonly #capacity: number;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  add(id: string): void {
    this.#ids.add(id);
    if (this.#ids.size > this.#capacity) {
      const oldest = this.#ids.values().next().value;
      if (oldest !== undefined) this.#ids.delete(oldest);
    }
  }
}
