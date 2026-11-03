import { describe, expect, it } from 'vitest';
import { videoFrameCount } from '../src/media/mp4.ts';

/** An ISO base media box with the given content. */
function box(type: string, ...content: Uint8Array[]): Uint8Array {
  const size = 8 + content.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let offset = 8;
  for (const c of content) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const u32 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (const [i, v] of values.entries()) view.setUint32(i * 4, v);
  return out;
};
const text = (s: string) => new TextEncoder().encode(s);

function track(handler: string, sampleTable: Uint8Array): Uint8Array {
  return box(
    'trak',
    box(
      'mdia',
      box('hdlr', u32(0, 0), text(handler), u32(0, 0, 0)),
      box('minf', box('stbl', sampleTable)),
    ),
  );
}

describe('videoFrameCount', () => {
  it("counts the video track's samples, not the audio track's", () => {
    const file = new Uint8Array([
      ...box('ftyp', text('isom'), u32(0)),
      ...box(
        'moov',
        track('soun', box('stsz', u32(0, 0, 9999))),
        track('vide', box('stsz', u32(0, 0, 450))),
      ),
      ...box('mdat', new Uint8Array(16)),
    ]);
    expect(videoFrameCount(file)).toBe(450);
  });

  it('adds up the time-to-sample table when there is no sample size box', () => {
    const file = box('moov', track('vide', box('stts', u32(0, 2, 100, 512, 20, 1024))));
    expect(videoFrameCount(file)).toBe(120);
  });

  it('says nothing for files it cannot read', () => {
    expect(videoFrameCount(new Uint8Array(4))).toBeNull();
    expect(videoFrameCount(box('ftyp', text('isom')))).toBeNull();
  });
});
