import { ValidationError } from '../errors.ts';
import { readWavInfo } from '../media/wav.ts';
import type { SpeechTranscriber } from '../ports.ts';

/** A note is a sentence or two; Muse Voice Transcribe accepts files up to 10 minutes. */
export const MAX_NOTE_MS = 2 * 60 * 1000;

const SAMPLE_RATES = [16_000, 24_000];

export class SpeechService {
  readonly #transcriber: SpeechTranscriber;

  constructor(transcriber: SpeechTranscriber) {
    this.#transcriber = transcriber;
  }

  /** Checks the recording is what the model accepts, then transcribes it. */
  async transcribeNote(audio: Uint8Array): Promise<{ text: string; durationMs: number }> {
    const wav = readWavInfo(audio);
    if (wav.channels !== 1 || wav.bitsPerSample !== 16 || !SAMPLE_RATES.includes(wav.sampleRate)) {
      throw new ValidationError('The recording must be mono 16-bit PCM at 16 or 24 kHz');
    }
    if (wav.durationMs > MAX_NOTE_MS) {
      throw new ValidationError('Notes can be at most two minutes long');
    }
    if (wav.durationMs < 200) return { text: '', durationMs: wav.durationMs };
    return this.#transcriber.transcribe(audio);
  }
}
