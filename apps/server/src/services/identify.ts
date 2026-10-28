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

export class IdentifyService {
  readonly #reader: MarkingsReader;

  constructor(reader: MarkingsReader) {
    this.#reader = reader;
  }

  async identify(photo: Uint8Array): Promise<IdentifyResult> {
    const image = await normaliseImage(photo, IDENTIFY_MAX_SIDE);
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

    if (best.length === 1) {
      return {
        read,
        verdict: 'corrected',
        containerNumber: first.value.value,
        candidates: [toCandidate(first)],
        explanation: `Read "${raw}", which fails the check digit. ${describeChanges(raw, first)} gives the only valid number.`,
      };
    }

    // Several repairs are equally close: ask the model to compare them with the photo.
    const values = best.map((c) => c.value.value);
    const { choice, reason } = await this.#reader.chooseNumber(image, values);
    const chosen = best.find((c) => c.value.value === choice);
    if (chosen) {
      return {
        read,
        verdict: 'corrected',
        containerNumber: chosen.value.value,
        candidates: best.map(toCandidate),
        explanation: `Read "${raw}", which fails the check digit. ${best.length} repairs are valid; compared with the photo: ${reason}`,
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
