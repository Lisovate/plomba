/**
 * Reads the number of frames in an MP4 or MOV clip from its boxes (ISO base
 * media file format), without decoding anything: the video track's sample
 * count. SAM 3.1 reports only the frames where it found something, so the
 * last tracked frame says nothing about how long the clip is.
 */

interface Box {
  readonly type: string;
  /** Where the box's content starts and ends. */
  readonly start: number;
  readonly end: number;
}

function* boxes(data: Uint8Array, start: number, end: number): Generator<Box> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return;
    yield { type, start: offset + header, end: offset + size };
    offset += size;
  }
}

function child(data: Uint8Array, parent: Box, type: string): Box | undefined {
  for (const box of boxes(data, parent.start, parent.end)) if (box.type === type) return box;
  return undefined;
}

function path(data: Uint8Array, parent: Box, types: readonly string[]): Box | undefined {
  let box: Box | undefined = parent;
  for (const type of types) {
    if (!box) return undefined;
    box = child(data, box, type);
  }
  return box;
}

/** The video track's frame count, or `null` when the file doesn't say (e.g. fragmented MP4). */
export function videoFrameCount(data: Uint8Array): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const file: Box = { type: '', start: 0, end: data.byteLength };
  const moov = child(data, file, 'moov');
  if (!moov) return null;
  for (const trak of boxes(data, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    // hdlr: version and flags (4), pre_defined (4), handler type (4).
    const hdlr = path(data, trak, ['mdia', 'hdlr']);
    if (!hdlr || hdlr.start + 12 > hdlr.end) continue;
    if (String.fromCharCode(...data.subarray(hdlr.start + 8, hdlr.start + 12)) !== 'vide') continue;
    const stbl = path(data, trak, ['mdia', 'minf', 'stbl']);
    if (!stbl) return null;
    // stsz: version and flags (4), sample size (4), sample count (4).
    const stsz = child(data, stbl, 'stsz');
    if (stsz && stsz.start + 12 <= stsz.end) {
      const count = view.getUint32(stsz.start + 8);
      return count > 0 ? count : null;
    }
    // stts: version and flags (4), entry count (4), then (sample count, delta) pairs.
    const stts = child(data, stbl, 'stts');
    if (!stts || stts.start + 8 > stts.end) return null;
    const entries = view.getUint32(stts.start + 4);
    let count = 0;
    for (let i = 0; i < entries && stts.start + 16 + i * 8 <= stts.end; i++) {
      count += view.getUint32(stts.start + 8 + i * 8);
    }
    return count > 0 ? count : null;
  }
  return null;
}
