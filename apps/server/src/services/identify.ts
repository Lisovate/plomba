/**
 * Identification as a verifiable loop: the model reads, a deterministic check
 * verifies, and the model is only asked again with a narrower question when
 * the check leaves more than one answer. The checker confirms the result.
 */

import type { IdentifyResult, MarkingsRead, NumberCandidate } from '@plomba/contracts';
import { type ContainerNumberCandidate, suggestContainerNumbers } from '@plomba/core';
import { normaliseImage } from '../media/images.ts';
import type { MarkingsReader } from '../ports.ts';

/** Enough resolution for door markings at a few metres; keeps the model call cheap. */
const IDENTIFY_MAX_SIDE = 1600;

/**
 * Tight or distant shots of the markings are enlarged to at least this size:
 * the vision model then sees more pixels per character. Measured in
 * docs/evaluation.md.
 */
export const DEFAULT_MIN_LONG_SIDE = 1024;

export interface IdentifyOptions {
  /** Enlarge smaller photos to this long side; 0 turns enlarging off. */
  readonly minLongSide?: number;
}

export class IdentifyService {
  readonly #reader: MarkingsReader;
  readonly #minLongSide: number;

  constructor(reader: MarkingsReader, options: IdentifyOptions = {}) {
    this.#reader = reader;
    this.#minLongSide = options.minLongSide ?? DEFAULT_MIN_LONG_SIDE;
  }

  async identify(photo: Uint8Array): Promise<IdentifyResult> {
    const image = await normaliseImage(photo, IDENTIFY_MAX_SIDE, {
      minLongSide: this.#minLongSide,
    });
    const read = await this.#reader.read(image);
    const raw = read.containerNumber?.trim();
    if (!raw) {
      return unreadable(read, 'No container number is visible. Photograph the doors straight on.');
    }

    const candidates = suggestContainerNumbers(raw);
    const best = candidates.filter(
      (c) => c.changedPositions.length === candidates[0]?.changedPositions.length,
    );
    const first = best[0];
    if (!first) {
      return unreadable(
        read,
        `Read "${raw}", which fails the ISO 6346 check and isn't one or two look-alike characters away from a valid number.`,
      );
    }

    if (first.changedPositions.length === 0) {
      return {
        read,
        verdict: 'verified',
        containerNumber: first.value.value,
        candidates: [toCandidate(first)],
        explanation: 'The check digit matches.',
      };
    }

    // The check digit detects a misread well but corrects it poorly: a read with
    // two wrong characters has dozens of look-alike variants, and about one in
    // ten passes by chance. So a repair is only ever a suggestion for the
    // checker to confirm (see docs/evaluation.md).
    if (best.length === 1) {
      return {
        read,
        verdict: 'suggested',
        containerNumber: null,
        candidates: [toCandidate(first)],
        explanation: `Read "${raw}", which fails the check digit. ${describeChanges(raw, first)} would make it valid: check those characters on the container.`,
      };
    }

    // Several repairs are equally close: ask the model which one the photo shows.
    const values = best.map((c) => c.value.value);
    const { choice, reason } = await this.#reader.chooseNumber(image, values);
    const chosen = best.find((c) => c.value.value === choice);
    if (chosen) {
      return {
        read,
        verdict: 'suggested',
        containerNumber: null,
        candidates: [chosen, ...best.filter((c) => c !== chosen)].map(toCandidate),
        explanation: `Read "${raw}", which fails the check digit; ${best.length} repairs are valid. Muse Spark suggests the first after comparing them with the photo: ${reason}`,
      };
    }
    return {
      read,
      verdict: 'ambiguous',
      containerNumber: null,
      candidates: best.map(toCandidate),
      explanation: `Read "${raw}", which fails the check digit, and ${best.length} repairs are equally likely. Compared with the photo: ${reason} Choose the one painted on the container.`,
    };
  }
}

function unreadable(read: MarkingsRead, explanation: string): IdentifyResult {
  return { read, verdict: 'unreadable', containerNumber: null, candidates: [], explanation };
}

function toCandidate(candidate: ContainerNumberCandidate): NumberCandidate {
  return {
    containerNumber: candidate.value.value,
    changedPositions: [...candidate.changedPositions],
  };
}

function describeChanges(raw: string, candidate: ContainerNumberCandidate): string {
  const read = raw.toUpperCase().replace(/[\s.\-_/]/g, '');
  const changes = candidate.changedPositions.map(
    (i) => `${read.charAt(i)} → ${candidate.value.value.charAt(i)} at position ${i + 1}`,
  );
  return `Reading ${changes.join(' and ')}`;
}
