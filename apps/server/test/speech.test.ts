import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import { readWavInfo } from '../src/media/wav.ts';
import { SpeechService } from '../src/services/speech.ts';
import { FakeTranscriber, makeWav } from './fakes.ts';

describe('readWavInfo', () => {
  it('reads the format and duration', () => {
    expect(readWavInfo(makeWav({ sampleRate: 24_000, ms: 1500 }))).toEqual({
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 1500,
    });
  });

  it('rejects anything that is not a WAV file', () => {
    expect(() => readWavInfo(new TextEncoder().encode('OggS not a wav file'))).toThrow(
      ValidationError,
    );
  });
});

describe('SpeechService', () => {
  it('transcribes a mono 16-bit recording at 16 or 24 kHz', async () => {
    const transcriber = new FakeTranscriber();
    const service = new SpeechService(transcriber);
    expect((await service.transcribeNote(makeWav())).text).toBe('wgniecenie przy drzwiach');
    expect(transcriber.calls).toBe(1);
  });

  it.each([
    ['stereo', { channels: 2 }],
    ['44.1 kHz', { sampleRate: 44_100 }],
    ['8-bit', { bits: 8 }],
    ['longer than two minutes', { ms: 121_000 }],
  ])('rejects a recording that is %s', async (_, options) => {
    const service = new SpeechService(new FakeTranscriber());
    await expect(service.transcribeNote(makeWav(options))).rejects.toThrow(ValidationError);
  });

  it('does not send an empty recording to the model', async () => {
    const transcriber = new FakeTranscriber();
    const result = await new SpeechService(transcriber).transcribeNote(makeWav({ ms: 50 }));
    expect(result.text).toBe('');
    expect(transcriber.calls).toBe(0);
  });
});
