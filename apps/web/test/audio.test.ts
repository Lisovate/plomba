import { describe, expect, it } from 'vitest';
import { encodeWav } from '../src/lib/audio.ts';

describe('encodeWav', () => {
  it('writes a mono 16-bit PCM WAV header and clamps samples', async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 24_000);
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    // Samples start after the 44-byte header.
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32768, 32767,
    ]);
  });
});
