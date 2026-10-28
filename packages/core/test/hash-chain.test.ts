import { describe, expect, it } from 'vitest';
import {
  type ChainEntry,
  canonicalJson,
  chainHash,
  GENESIS_HASH,
  sha256Hex,
  verifyChain,
} from '../src/hash-chain.ts';

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('rejects values JSON cannot represent', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

async function buildChain(contents: unknown[]): Promise<ChainEntry[]> {
  const entries: ChainEntry[] = [];
  let previousHash = GENESIS_HASH;
  for (const content of contents) {
    const hash = await chainHash(previousHash, content);
    entries.push({ previousHash, hash, content });
    previousHash = hash;
  }
  return entries;
}

describe('verifyChain', () => {
  it('accepts an untouched chain', async () => {
    const chain = await buildChain([{ handover: 1 }, { handover: 2 }, { handover: 3 }]);
    expect(await verifyChain(chain)).toEqual({ ok: true });
  });

  it('detects an edited entry', async () => {
    const chain = await buildChain([{ dents: 0 }, { dents: 1 }, { dents: 1 }]);
    chain[1] = { ...(chain[1] as ChainEntry), content: { dents: 0 } };
    expect(await verifyChain(chain)).toEqual({ ok: false, index: 1, reason: 'hash' });
  });

  it('detects a removed entry', async () => {
    const chain = await buildChain([{ n: 1 }, { n: 2 }, { n: 3 }]);
    chain.splice(1, 1);
    expect(await verifyChain(chain)).toEqual({ ok: false, index: 1, reason: 'link' });
  });
});
