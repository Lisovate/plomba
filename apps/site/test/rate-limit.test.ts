import { describe, expect, it } from 'vitest';
import { clientKey, RateLimiter } from '../server/rate-limit.ts';

function limiter(limit = 3, windowMs = 60_000, maxClients?: number) {
  let now = 1_000_000;
  const instance = new RateLimiter({
    limit,
    windowMs,
    now: () => now,
    ...(maxClients ? { maxClients } : {}),
  });
  return {
    instance,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the rate limit', () => {
  it('allows the limit, then refuses with the time until a slot frees up', () => {
    const { instance, advance } = limiter(3, 60_000);
    expect(instance.hit('a')).toEqual({ allowed: true });
    advance(10_000);
    expect(instance.hit('a')).toEqual({ allowed: true });
    expect(instance.hit('a')).toEqual({ allowed: true });
    expect(instance.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it('slides: each request leaves the window on its own', () => {
    const { instance, advance } = limiter(2, 60_000);
    instance.hit('a');
    advance(30_000);
    instance.hit('a');
    expect(instance.hit('a').allowed).toBe(false);
    advance(30_000);
    expect(instance.hit('a').allowed).toBe(true);
    expect(instance.hit('a').allowed).toBe(false);
  });

  it('does not count refused requests', () => {
    const { instance, advance } = limiter(1, 60_000);
    instance.hit('a');
    advance(59_000);
    expect(instance.hit('a').allowed).toBe(false);
    advance(1_000);
    expect(instance.hit('a').allowed).toBe(true);
  });

  it('limits each client separately', () => {
    const { instance } = limiter(1);
    expect(instance.hit('a').allowed).toBe(true);
    expect(instance.hit('a').allowed).toBe(false);
    expect(instance.hit('b').allowed).toBe(true);
  });

  it('forgets clients once their window has passed', () => {
    const { instance, advance } = limiter(1, 60_000);
    instance.hit('a');
    instance.hit('b');
    advance(30_000);
    instance.hit('c');
    advance(30_000);
    instance.sweep();
    expect(instance.size).toBe(1);
  });

  it('keeps memory bounded by forgetting the stalest client first', () => {
    const { instance } = limiter(1, 60_000, 2);
    instance.hit('a');
    instance.hit('b');
    instance.hit('c');
    expect(instance.size).toBe(2);
    expect(instance.hit('a').allowed).toBe(true);
    expect(instance.hit('c').allowed).toBe(false);
  });
});

describe('client keys', () => {
  it('uses IPv4 addresses as they are, including IPv4-mapped IPv6', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 addresses by their /64 network', () => {
    expect(clientKey('2001:db8:85a3:12:8a2e:370:7334:1')).toBe('2001:db8:85a3:12::/64');
    expect(clientKey('2001:0DB8:85A3:0012:ffff::2')).toBe('2001:db8:85a3:12::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
  });
});
