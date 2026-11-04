import type { Video } from '@plomba/contracts';

/** Sniff the container, independent of the upload's name or declared type. */
export function videoContentType(data: Uint8Array): Video['contentType'] | undefined {
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return 'video/webm';
  }
  const text = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data.byteLength < 12 || text(4, 8) !== 'ftyp') return undefined;
  return text(8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
}
