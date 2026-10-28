/**
 * Muse Voice Transcribe as the speech transcriber, for spoken notes in Polish
 * or English.
 */

import type { SpeechTranscriber } from '../../ports.ts';
import type { MetaClient } from './client.ts';

/**
 * Words a checker uses, in both languages. They bias recognition towards
 * container vocabulary without forcing it.
 */
export const INSPECTION_KEYWORDS = [
  'dent',
  'hole',
  'rust',
  'corrosion',
  'crack',
  'bent',
  'panel',
  'corner post',
  'corner casting',
  'locking bar',
  'door',
  'roof',
  'rail',
  'seal',
  'wgniecenie',
  'dziura',
  'korozja',
  'rdza',
  'pęknięcie',
  'wygięcie',
  'słupek narożny',
  'naroże',
  'drzwi',
  'dach',
  'plomba',
];

export class MuseVoiceTranscriber implements SpeechTranscriber {
  readonly #client: MetaClient;
  readonly #model: string;

  constructor(client: MetaClient, options: { readonly model: string }) {
    this.#client = client;
    this.#model = options.model;
  }

  async transcribe(audio: Uint8Array): Promise<{ text: string; durationMs: number }> {
    const response = await this.#client.transcribe(audio, {
      model: this.#model,
      mode: 'PUSH_TO_TALK',
      audioEncoding: 'WAV',
      languageBias: ['Polish', 'English'],
      keywords: INSPECTION_KEYWORDS,
    });
    return { text: response.transcript.trim(), durationMs: response.audioDurationMs };
  }
}
