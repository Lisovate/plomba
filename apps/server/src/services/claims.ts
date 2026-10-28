/**
 * Drafting a damage claim with a verifiable agent. Muse Spark gathers the
 * facts through tools and writes the claim; the service then checks every
 * item against the sealed records and sends the draft back with the problems
 * until it passes. The checker gets a draft whose evidence is known to match
 * the records.
 */

import {
  type Claim,
  type ClaimCheck,
  type ClaimResult,
  ClaimSchema,
  type Handover,
  type Mark,
} from '@plomba/contracts';
import { verifyChain } from '@plomba/core';
import { ConflictError, NotFoundError, UpstreamError } from '../errors.ts';
import { normaliseImage } from '../media/images.ts';
import type {
  Agent,
  AgentTool,
  ContainerRepository,
  HandoverRepository,
  ImageInput,
  MarkRepository,
  MediaStore,
  PhotoRepository,
} from '../ports.ts';

/** Drafts the agent may write before the service gives up. */
const MAX_ATTEMPTS = 3;

/** Photos sent with the task; more cost tokens without adding facts. */
const MAX_IMAGES = 2;

export interface ClaimServiceDeps {
  readonly containers: ContainerRepository;
  readonly handovers: HandoverRepository;
  readonly photos: PhotoRepository;
  readonly marks: MarkRepository;
  readonly media: MediaStore;
  readonly agent: Agent;
}

const LANGUAGES = { en: 'English', pl: 'Polish' } as const;

const INSTRUCTIONS = `You draft damage claims for intermodal container handovers, for a terminal or depot to send.

Use the tools to establish the facts before writing. Rules:
- Claim only damage that get_handover_comparison lists under newDamage: it was not recorded at the previous handover.
- Cite each item with its markId, locationCode and damageCode exactly as the tools give them, and photoSha256 as given (null if there is none).
- Address the claim to the party that had custody between the two handovers, normally the party that handed the container over at this handover.
- The letter states the container number, the places and times of both handovers, each damaged item with its ISO 9897 (CEDEX) location and damage code, and the SHA-256 hashes of both sealed records as evidence. Mention whether the container's record chain verified intact.
- In the letter, refer to damage by its location and damage code; don't show internal IDs such as markId or handover IDs. Write dates and times readably in UTC, e.g. "28 October 2026, 07:47 UTC". In Polish, a sealed record is "zaplombowany rekord".
- Be factual and brief. Don't estimate repair costs or assign blame beyond what the records show.`;

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['addressee', 'subject', 'summary', 'items', 'letter'],
  properties: {
    addressee: { type: 'string' },
    subject: { type: 'string' },
    summary: { type: 'string', description: 'One or two sentences.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['markId', 'locationCode', 'damageCode', 'description', 'photoSha256'],
        properties: {
          markId: { type: 'string' },
          locationCode: { type: 'string' },
          damageCode: { type: 'string' },
          description: { type: 'string' },
          photoSha256: { type: ['string', 'null'] },
        },
      },
    },
    letter: { type: 'string', description: 'The full claim letter, plain text.' },
  },
} as const;

interface Facts {
  readonly handover: Handover;
  readonly previous: Handover;
  readonly newDamage: readonly Mark[];
  readonly photoHash: ReadonlyMap<string, string>;
}

export class ClaimService {
  readonly #d: ClaimServiceDeps;

  constructor(deps: ClaimServiceDeps) {
    this.#d = deps;
  }

  async draft(handoverId: string, language: keyof typeof LANGUAGES): Promise<ClaimResult> {
    const handover = this.#d.handovers.get(handoverId);
    if (!handover) throw new NotFoundError(`Handover ${handoverId} not found`);
    if (!handover.seal) throw new ConflictError('Seal the handover before drafting a claim');
    const previous = handover.previousHandoverId
      ? this.#d.handovers.get(handover.previousHandoverId)
      : undefined;
    if (!previous?.seal) {
      return {
        status: 'no-new-damage',
        explanation: 'There is no earlier sealed handover of this container to compare with.',
      };
    }

    const current = this.#d.marks
      .listForHandover(handover.id)
      .filter((m) => m.source === 'confirmed');
    const newDamage = current.filter((m) => m.previousMarkId === null && m.status === 'new');
    if (newDamage.length === 0) {
      return {
        status: 'no-new-damage',
        explanation: 'Every damage in this handover was already recorded at the previous one.',
      };
    }
    const photos = this.#d.photos.listForHandover(handover.id);
    const facts: Facts = {
      handover,
      previous,
      newDamage,
      photoHash: new Map(photos.map((p) => [p.id, p.sha256])),
    };

    const run = this.#d.agent.start({
      instructions: INSTRUCTIONS,
      prompt: `Draft a damage claim in ${LANGUAGES[language]} for the new damage found at handover ${handover.id} of container ${handover.containerNumber}. The attached photos show the faces with new damage.`,
      images: await this.#images(newDamage, facts.photoHash),
      tools: this.#tools(facts, previous, current),
      answer: { name: 'damage_claim', schema: ANSWER_SCHEMA },
      parser: ClaimSchema,
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const claim = await run.answer();
      const { problems, checks } = verifyClaim(claim, facts);
      if (problems.length === 0) {
        return {
          status: 'drafted',
          claim,
          verification: { attempts: attempt, toolCalls: [...run.toolCalls], checks },
        };
      }
      run.correct(
        `Your draft doesn't match the sealed records:\n${problems.map((p) => `- ${p}`).join('\n')}\nFix these and answer again.`,
      );
    }
    throw new UpstreamError(
      `The claim draft still failed verification after ${MAX_ATTEMPTS} attempts`,
    );
  }

  #tools(facts: Facts, previous: Handover, current: readonly Mark[]): AgentTool[] {
    const describe = (h: Handover) => ({
      id: h.id,
      direction: h.direction === 'in' ? 'gate-in' : 'gate-out',
      place: h.place,
      startedAt: h.startedAt,
      sealedAt: h.closedAt,
      checker: h.checker,
      handedOverBy: h.handedOverBy,
      receivedBy: h.receivedBy,
      sealNumbers: h.sealNumbers,
      recordHash: h.seal?.hash ?? null,
    });
    const mark = (m: Mark) => ({
      markId: m.id,
      face: m.face,
      locationCode: m.locationCode,
      damageCode: m.damageCode,
      componentCode: m.componentCode,
      sizeMm: {
        width: Math.round((m.rect.u1 - m.rect.u0) * 1000),
        height: Math.round((m.rect.v1 - m.rect.v0) * 1000),
      },
      note: m.note,
      photoSha256: m.photoId ? (facts.photoHash.get(m.photoId) ?? null) : null,
    });
    return [
      {
        name: 'get_handover_comparison',
        description:
          'The previous and current handover of the container, the damage that is new since the previous handover, and what happened to the damage recorded before.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        run: async () => ({
          containerNumber: facts.handover.containerNumber,
          previousHandover: describe(previous),
          currentHandover: describe(facts.handover),
          newDamage: facts.newDamage.map(mark),
          earlierDamageNow: current
            .filter((m) => m.previousMarkId !== null)
            .map((m) => ({ ...mark(m), status: m.status })),
        }),
      },
      {
        name: 'get_container_history',
        description:
          'Every sealed handover of the container, oldest first, and whether the chain of record hashes verifies intact.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        run: async () => {
          const links = this.#d.handovers.chain(facts.handover.containerNumber);
          const verification = await verifyChain(
            links.map((l) => ({
              previousHash: l.previousHash,
              hash: l.hash,
              content: JSON.parse(l.record) as unknown,
            })),
          );
          const container = this.#d.containers.get(facts.handover.containerNumber);
          return {
            container,
            chainIntact: verification.ok,
            handovers: this.#d.handovers
              .listForContainer(facts.handover.containerNumber)
              .filter((h) => h.seal)
              .reverse()
              .map(describe),
          };
        },
      },
    ];
  }

  async #images(
    newDamage: readonly Mark[],
    photoHash: ReadonlyMap<string, string>,
  ): Promise<ImageInput[]> {
    const hashes = [
      ...new Set(newDamage.flatMap((m) => (m.photoId ? [photoHash.get(m.photoId)] : []))),
    ];
    const images: ImageInput[] = [];
    for (const sha256 of hashes.slice(0, MAX_IMAGES)) {
      const data = sha256 ? await this.#d.media.get(sha256) : undefined;
      if (data) images.push(await normaliseImage(data, 1024));
    }
    return images;
  }
}

/** Checks a draft against the records. Every problem is phrased as an instruction to the agent. */
export function verifyClaim(
  claim: Claim,
  facts: Facts,
): { problems: string[]; checks: ClaimCheck[] } {
  const problems: string[] = [];
  const byId = new Map(facts.newDamage.map((m) => [m.id, m]));
  const cited = new Set<string>();

  if (claim.items.length === 0) problems.push('List at least one damage item.');
  for (const item of claim.items) {
    const mark = byId.get(item.markId);
    if (!mark) {
      problems.push(
        `Item ${item.markId} is not new damage in this handover. Claim only: ${[...byId.keys()].join(', ')}.`,
      );
      continue;
    }
    if (cited.has(item.markId)) problems.push(`Item ${item.markId} is listed twice.`);
    cited.add(item.markId);
    if (item.locationCode !== mark.locationCode || item.damageCode !== mark.damageCode) {
      problems.push(
        `Item ${item.markId}: the record says location ${mark.locationCode} and damage ${mark.damageCode}.`,
      );
    }
    const photo = mark.photoId ? (facts.photoHash.get(mark.photoId) ?? null) : null;
    if (item.photoSha256 !== photo) {
      problems.push(`Item ${item.markId}: the photo's SHA-256 is ${photo ?? 'null (no photo)'}.`);
    }
  }
  const missing = [...byId.keys()].filter((id) => !cited.has(id));
  if (missing.length > 0) problems.push(`Also claim the new damage ${missing.join(', ')}.`);

  const hash = facts.handover.seal?.hash ?? '';
  const previousHash = facts.previous.seal?.hash ?? '';
  if (!claim.letter.includes(facts.handover.containerNumber)) {
    problems.push(`The letter must state the container number ${facts.handover.containerNumber}.`);
  }
  if (!claim.letter.includes(hash) || !claim.letter.includes(previousHash)) {
    problems.push(`The letter must cite both record hashes in full: ${previousHash} and ${hash}.`);
  }
  if (!claim.addressee.trim()) problems.push('Name the addressee.');

  return {
    problems,
    checks: ['items-are-new-damage', 'codes-and-photos-match', 'letter-cites-records'],
  };
}
