/**
 * Damage recorded by voice: Muse Voice Transcribe hears the checker, Muse
 * Spark codes what they described ("wgniecenie, lewy bok, sekcja trzecia,
 * dół"), and each damage becomes a proposed mark on the sections named. The
 * checker confirms each proposal, as with damage the models find on photos.
 */

import type { Face, SpokenDamageResult } from '@plomba/contracts';
import { sectionRect } from '@plomba/core';
import { ConflictError } from '../errors.ts';
import type { DamageNoteParser } from '../ports.ts';
import type { HandoverService } from './handovers.ts';
import type { SpeechService } from './speech.ts';

export interface SpokenDamageServiceDeps {
  readonly speech: SpeechService;
  readonly parser: DamageNoteParser;
  readonly handovers: HandoverService;
}

export class SpokenDamageService {
  readonly #d: SpokenDamageServiceDeps;

  constructor(deps: SpokenDamageServiceDeps) {
    this.#d = deps;
  }

  /** `face` is the face the checker is looking at; they may name another. */
  async record(handoverId: string, face: Face, audio: Uint8Array): Promise<SpokenDamageResult> {
    // Fails early for a sealed or unknown handover, before any model is called.
    const { container, handover } = this.#d.handovers.detail(handoverId);
    if (handover.status !== 'open') throw new ConflictError(`Handover ${handoverId} is closed`);
    const { text } = await this.#d.speech.transcribeNote(audio);
    if (!text.trim()) return { transcript: text, marks: [], unplaced: [] };

    const items = await this.#d.parser.parse(text, { face, dimensions: container.dimensions });
    const marks = [];
    const unplaced: string[] = [];
    for (const item of items) {
      let rect: ReturnType<typeof sectionRect> | undefined;
      try {
        rect = item.location
          ? sectionRect(item.face, container.dimensions, item.location)
          : undefined;
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
      if (!rect) {
        unplaced.push(item.note);
        continue;
      }
      marks.push(
        this.#d.handovers.addMark(handoverId, {
          face: item.face,
          rect,
          outline: null,
          damageCode: item.damageCode,
          componentCode: item.componentCode,
          status: 'new',
          source: 'proposed',
          previousMarkId: null,
          photoId: null,
          note: item.note,
        }),
      );
    }
    return { transcript: text, marks, unplaced };
  }
}
