/**
 * An in-memory sliding-window rate limit per client. Nothing is written to
 * disk: entries are dropped once their window has passed.
 */

export interface RateLimitOptions {
  /** Requests allowed per window. */
  readonly limit: number;
  readonly windowMs: number;
  /** Clients tracked at most; the oldest is forgotten first. */
  readonly maxClients?: number;
  readonly now?: () => number;
}

export type RateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxClients: number;
  readonly #now: () => number;
  /** Request times per client, oldest first. */
  readonly #hits = new Map<string, number[]>();

  constructor(options: RateLimitOptions) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#maxClients = options.maxClients ?? 10_000;
    this.#now = options.now ?? Date.now;
  }

  /** Counts a request from `client` and says whether it may go ahead. */
  hit(client: string): RateLimitResult {
    const now = this.#now();
    const recent = (this.#hits.get(client) ?? []).filter((t) => now - t < this.#windowMs);
    if (recent.length >= this.#limit) {
      this.#hits.set(client, recent);
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((oldest + this.#windowMs - now) / 1000),
      };
    }
    recent.push(now);
    // Re-inserting keeps the map ordered by last activity, so the first key is the stalest.
    this.#hits.delete(client);
    this.#hits.set(client, recent);
    if (this.#hits.size > this.#maxClients) {
      const stalest = this.#hits.keys().next().value;
      if (stalest !== undefined) this.#hits.delete(stalest);
    }
    return { allowed: true };
  }

  /** Forgets clients whose requests have all left the window. */
  sweep(): void {
    const now = this.#now();
    for (const [client, times] of this.#hits) {
      const latest = times.at(-1);
      if (latest === undefined || now - latest >= this.#windowMs) this.#hits.delete(client);
    }
  }

  get size(): number {
    return this.#hits.size;
  }
}

/**
 * The key a client is limited by: its IPv4 address, or the /64 network of an
 * IPv6 address, since one machine usually holds a whole /64.
 */
export function clientKey(address: string): string {
  const ip = address.trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!ip.includes(':')) return ip;

  const [head = '', tail] = ip.split('::', 2);
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  const prefix = groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::/64`;
}
