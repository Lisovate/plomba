/**
 * A tamper-evident history: each entry's hash covers the previous entry's hash
 * and the entry's own content, so changing any past record breaks every hash
 * after it.
 *
 * Content is hashed as canonical JSON (keys sorted, no whitespace), so the same
 * record always produces the same hash on the server and in the browser.
 */

export const GENESIS_HASH = '0'.repeat(64);

/** Serialises JSON-compatible data with object keys sorted. Rejects values JSON can't represent faithfully. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Cannot hash a non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`Cannot hash a value of type ${typeof value}`);
  }
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function chainHash(previousHash: string, content: unknown): Promise<string> {
  return sha256Hex(`${previousHash}\n${canonicalJson(content)}`);
}

export interface ChainEntry {
  readonly previousHash: string;
  readonly hash: string;
  readonly content: unknown;
}

export type ChainVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly index: number; readonly reason: 'link' | 'hash' };

/** Checks that entries (oldest first) link to each other and that each hash matches its content. */
export async function verifyChain(entries: readonly ChainEntry[]): Promise<ChainVerification> {
  let expectedPrevious = GENESIS_HASH;
  for (const [index, entry] of entries.entries()) {
    if (entry.previousHash !== expectedPrevious) return { ok: false, index, reason: 'link' };
    if ((await chainHash(entry.previousHash, entry.content)) !== entry.hash) {
      return { ok: false, index, reason: 'hash' };
    }
    expectedPrevious = entry.hash;
  }
  return { ok: true };
}
