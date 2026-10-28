import { ValidationError } from '../errors.ts';

export interface WavInfo {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly durationMs: number;
}

/** Reads a RIFF/WAVE header. Throws `ValidationError` for anything else. */
export function readWavInfo(data: Uint8Array): WavInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (offset: number) =>
    offset + 4 <= data.byteLength ? String.fromCharCode(...data.subarray(offset, offset + 4)) : '';
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
    throw new ValidationError('The audio is not a WAV file');

  let format: Omit<WavInfo, 'durationMs'> | undefined;
  let audioFormat = 0;
  for (let offset = 12; offset + 8 <= data.byteLength; ) {
    const size = view.getUint32(offset + 4, true);
    if (tag(offset) === 'fmt ' && offset + 24 <= data.byteLength) {
      audioFormat = view.getUint16(offset + 8, true);
      format = {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (tag(offset) === 'data' && format) {
      if (audioFormat !== 1) throw new ValidationError('The WAV file must hold uncompressed PCM');
      const bytesPerSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8);
      const bytes = Math.min(size, data.byteLength - offset - 8);
      return { ...format, durationMs: Math.round((1000 * bytes) / bytesPerSecond) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new ValidationError('The WAV file has no audio data');
}
