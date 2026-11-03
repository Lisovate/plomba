/**
 * Checks the `Plomba-Signature` header of a webhook delivery:
 * `t=<unix seconds>,v1=<hex>`, where v1 is HMAC-SHA256, keyed with the
 * webhook secret, of `<t>.<raw body>`.
 *
 * - The MAC is computed over the body's bytes exactly as received, before
 *   any JSON parsing, which could reorder or re-encode them.
 * - It is compared in constant time.
 * - A delivery signed too long ago is refused even when the MAC is right, so
 *   one captured on the way can't be replayed later. Plomba signs every retry
 *   afresh, so a retry is never refused for its age.
 * - Several v1 values are accepted, so the sender can sign with an old and
 *   a new secret while the secret is being rotated.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureCheck =
  | { readonly ok: true; readonly signedAt: number }
  | {
      readonly ok: false;
      /**
       * - `missing`: no header;
       * - `malformed`: no timestamp or no v1 signature in it;
       * - `mismatch`: not signed with our secret, or the body was changed;
       * - `stale`: signed with our secret, but too long ago (a replay).
       */
      readonly reason: 'missing' | 'malformed' | 'mismatch' | 'stale';
    };

export interface VerifyOptions {
  /** Now, in unix seconds. */
  readonly now?: number;
  /** How far the timestamp may be from now; 5 minutes by default. */
  readonly toleranceSeconds?: number;
}

export function verifySignature(
  secret: string,
  header: string | undefined,
  rawBody: Uint8Array,
  options: VerifyOptions = {},
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing' };
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const matches = signatures.some((hex) => {
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
    return timingSafeEqual(Buffer.from(hex, 'hex'), expected);
  });
  if (!matches) return { ok: false, reason: 'mismatch' };

  const signedAt = Number(timestamp);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - signedAt) > (options.toleranceSeconds ?? 300)) {
    return { ok: false, reason: 'stale' };
  }
  return { ok: true, signedAt };
}
