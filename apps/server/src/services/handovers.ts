/**
 * The handover workflow: register the container, start a handover against the
 * previous one, collect photos and marks, then seal the record into the
 * container's hash chain.
 */

import type {
  Container,
  ContainerHistory,
  CreateMark,
  Handover,
  HandoverDetail,
  HandoverSummary,
  Mark,
  Photo,
  RegisterContainer,
  StartHandover,
  UpdateMark,
} from '@plomba/contracts';
import {
  chainHash,
  clampToFace,
  DEFAULT_DIMENSIONS,
  type Face,
  GENESIS_HASH,
  locationCode,
  parseContainerNumber,
  parseSizeType,
  type Quad,
  rectOverlap,
  verifyChain,
} from '@plomba/core';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import { blurRegions, normaliseImage } from '../media/images.ts';
import type {
  Clock,
  ContainerRepository,
  DamageDetector,
  HandoverRepository,
  IdGenerator,
  MarkRepository,
  MediaStore,
  PhotoRepository,
  Segmenter,
  TransactionRunner,
} from '../ports.ts';
import { findingsToDrafts } from './damage.ts';
import { detectFaceCorners, findPrivacyRegions } from './vision.ts';

export interface HandoverServiceDeps {
  readonly containers: ContainerRepository;
  readonly handovers: HandoverRepository;
  readonly photos: PhotoRepository;
  readonly marks: MarkRepository;
  readonly media: MediaStore;
  readonly segmenter: Segmenter;
  readonly detector: DamageDetector;
  readonly transaction: TransactionRunner;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

/** Attempts at sealing when another handover of the same container wins the race. */
const SEAL_ATTEMPTS = 3;

/** A proposal overlapping an existing mark this much is the same damage. */
const DUPLICATE_OVERLAP = 0.5;

export class HandoverService {
  readonly #d: HandoverServiceDeps;

  constructor(deps: HandoverServiceDeps) {
    this.#d = deps;
  }

  // Containers -------------------------------------------------------------

  registerContainer(input: RegisterContainer): Container {
    const parsed = parseContainerNumber(input.number);
    if (!parsed.ok) {
      throw new ValidationError(`${input.number} is not a valid ISO 6346 container number`, {
        issues: [{ path: 'number', message: parsed.error.code }],
      });
    }
    const number = parsed.value.value;
    const sizeType = input.sizeTypeCode ? parseSizeType(input.sizeTypeCode) : undefined;

    return this.#d.transaction(() => {
      const existing = this.#d.containers.get(number);
      if (existing) {
        if (sizeType && existing.sizeTypeCode !== sizeType.code) {
          this.#d.containers.updateSizeType(number, sizeType.code, sizeType.dimensions);
          return { ...existing, sizeTypeCode: sizeType.code, dimensions: sizeType.dimensions };
        }
        return existing;
      }
      const container: Container = {
        number,
        sizeTypeCode: sizeType?.code ?? null,
        dimensions: sizeType?.dimensions ?? DEFAULT_DIMENSIONS,
        createdAt: this.#now(),
      };
      this.#d.containers.insert(container);
      return container;
    });
  }

  async history(number: string): Promise<ContainerHistory> {
    const container = this.#container(number);
    const links = this.#d.handovers.chain(container.number);
    const verification = await verifyChain(
      links.map((link) => ({
        previousHash: link.previousHash,
        hash: link.hash,
        content: JSON.parse(link.record) as unknown,
      })),
    );
    return {
      container,
      handovers: this.#d.handovers.listForContainer(container.number),
      chain: {
        ok: verification.ok,
        length: links.length,
        brokenAt: verification.ok ? null : verification.index,
      },
    };
  }

  // Handovers --------------------------------------------------------------

  start(input: StartHandover): Handover {
    const container = this.#container(input.containerNumber);
    const id = this.#d.newId();
    this.#d.transaction(() => {
      this.#d.handovers.insert({
        id,
        containerNumber: container.number,
        direction: input.direction,
        place: input.place,
        checker: input.checker,
        handedOverBy: input.handedOverBy ?? null,
        receivedBy: input.receivedBy ?? null,
        sealNumbers: input.sealNumbers,
        startedAt: this.#now(),
        previousHandoverId: this.#d.handovers.findLastClosed(container.number)?.id ?? null,
      });
    });
    return this.#handover(id);
  }

  recent(limit = 30): HandoverSummary[] {
    return this.#d.handovers.listRecent(limit);
  }

  detail(id: string): HandoverDetail {
    const handover = this.#handover(id);
    const previousMarks = handover.previousHandoverId
      ? this.#d.marks
          .listForHandover(handover.previousHandoverId)
          .filter((m) => m.source !== 'rejected' && m.status !== 'repaired')
      : [];
    return {
      handover,
      container: this.#container(handover.containerNumber),
      photos: this.#d.photos.listForHandover(id),
      marks: this.#d.marks.listForHandover(id),
      previousMarks,
    };
  }

  /**
   * Stores a photo of one face. Faces and number plates are blurred before the
   * photo is written anywhere; the face's corners are detected so marks can be
   * placed on it and drawn back onto it.
   */
  async addPhoto(
    handoverId: string,
    input: { face: Face; data: Uint8Array; capturedAt?: string },
  ): Promise<Photo> {
    this.#openHandover(handoverId);
    const image = await normaliseImage(input.data);
    const [privacyRegions, corners] = await Promise.all([
      findPrivacyRegions(this.#d.segmenter, image),
      detectFaceCorners(this.#d.segmenter, image),
    ]);
    const redacted = await blurRegions(image, privacyRegions);
    const stored = await this.#d.media.put(redacted.data);

    const id = this.#d.newId();
    this.#d.transaction(() => {
      this.#openHandover(handoverId);
      this.#d.photos.insert({
        id,
        handoverId,
        face: input.face,
        sha256: stored.sha256,
        width: redacted.width,
        height: redacted.height,
        corners,
        cornersSource: corners ? 'detected' : null,
        redactedRegions: privacyRegions.length,
        capturedAt: input.capturedAt ?? this.#now(),
      });
    });
    return this.#photo(handoverId, id);
  }

  updateCorners(handoverId: string, photoId: string, corners: Quad): Photo {
    return this.#d.transaction(() => {
      this.#openHandover(handoverId);
      this.#photo(handoverId, photoId);
      this.#d.photos.updateCorners(photoId, corners, 'adjusted');
      return this.#photo(handoverId, photoId);
    });
  }

  addMark(handoverId: string, input: CreateMark): Mark {
    return this.#d.transaction(() => {
      const handover = this.#openHandover(handoverId);
      const { dimensions } = this.#container(handover.containerNumber);
      if (input.photoId) this.#photo(handoverId, input.photoId);
      if (input.previousMarkId) {
        const previous = this.#d.marks.get(input.previousMarkId);
        if (!previous || previous.handoverId !== handover.previousHandoverId) {
          throw new ValidationError('previousMarkId is not a mark of the previous handover');
        }
      }
      const rect = clampToFace(input.face, input.rect, dimensions);
      const id = this.#d.newId();
      this.#d.marks.insert({
        id,
        handoverId,
        face: input.face,
        rect,
        outline: input.outline,
        locationCode: locationCode(input.face, rect, dimensions),
        damageCode: input.damageCode,
        componentCode: input.componentCode,
        status: input.status,
        source: input.source,
        previousMarkId: input.previousMarkId,
        photoId: input.photoId,
        note: input.note,
        createdAt: this.#now(),
      });
      return this.#mark(handoverId, id);
    });
  }

  updateMark(handoverId: string, markId: string, patch: UpdateMark): Mark {
    return this.#d.transaction(() => {
      const handover = this.#openHandover(handoverId);
      const mark = this.#mark(handoverId, markId);
      const { dimensions } = this.#container(handover.containerNumber);
      const rect = patch.rect ? clampToFace(mark.face, patch.rect, dimensions) : mark.rect;
      const updated: Mark = {
        ...mark,
        ...patch,
        rect,
        locationCode: locationCode(mark.face, rect, dimensions),
      };
      this.#d.marks.update(updated);
      return updated;
    });
  }

  /**
   * Looks for damage on a registered photo: Muse Spark finds and codes it,
   * SAM 3.1 outlines it, and each finding becomes a proposed mark on the face
   * for the checker to confirm or reject. Damage already marked is skipped.
   */
  async proposeDamage(handoverId: string, photoId: string): Promise<Mark[]> {
    const handover = this.#openHandover(handoverId);
    const photo = this.#photo(handoverId, photoId);
    const { corners } = photo;
    if (!corners) throw new ConflictError('Place the face corners before looking for damage');
    const data = await this.#d.media.get(photo.sha256);
    if (!data) throw new NotFoundError(`The file of photo ${photoId} is missing`);
    const image = {
      data,
      mimeType: 'image/jpeg' as const,
      width: photo.width,
      height: photo.height,
    };

    const findings = await this.#d.detector.detect(image);
    const outlines = await this.#d.segmenter.refine(
      image,
      findings.map((f) => f.box),
    );
    const { dimensions } = this.#container(handover.containerNumber);
    const drafts = findingsToDrafts(findings, outlines, photo.face, dimensions, corners);

    return this.#d.transaction(() => {
      this.#openHandover(handoverId);
      const existing = this.#d.marks
        .listForHandover(handoverId)
        .filter((m) => m.face === photo.face && m.source !== 'rejected');
      const created: Mark[] = [];
      for (const draft of drafts) {
        if (existing.some((m) => rectOverlap(m.rect, draft.rect) > DUPLICATE_OVERLAP)) continue;
        const id = this.#d.newId();
        this.#d.marks.insert({
          id,
          handoverId,
          face: photo.face,
          rect: draft.rect,
          outline: draft.outline,
          locationCode: locationCode(photo.face, draft.rect, dimensions),
          damageCode: draft.damageCode,
          componentCode: draft.componentCode,
          status: 'new',
          source: 'proposed',
          previousMarkId: null,
          photoId,
          note: draft.note,
          createdAt: this.#now(),
        });
        const mark = this.#mark(handoverId, id);
        existing.push(mark);
        created.push(mark);
      }
      return created;
    });
  }

  /**
   * Closes the handover and appends it to the container's hash chain. The
   * sealed record lists every photo by its SHA-256, so the photos are covered
   * by the chain too.
   */
  async close(handoverId: string): Promise<Handover> {
    for (let attempt = 1; ; attempt++) {
      const handover = this.#openHandover(handoverId);
      if (this.#d.marks.listForHandover(handoverId).some((m) => m.source === 'proposed')) {
        throw new ConflictError('Confirm or reject the proposed damage before sealing');
      }
      const closedAt = this.#now();
      const record = this.#sealedRecord(handover, closedAt);
      const links = this.#d.handovers.chain(handover.containerNumber);
      const previousHash = links.at(-1)?.hash ?? GENESIS_HASH;
      const hash = await chainHash(previousHash, record);
      try {
        this.#d.transaction(() => {
          const latest = this.#d.handovers.chain(handover.containerNumber).at(-1)?.hash;
          if ((latest ?? GENESIS_HASH) !== previousHash) {
            throw new ConflictError('The chain moved on while sealing');
          }
          this.#d.handovers.seal(handoverId, {
            sequence: links.length,
            previousHash,
            hash,
            record: JSON.stringify(record),
            closedAt,
          });
        });
        return this.#handover(handoverId);
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt >= SEAL_ATTEMPTS) throw error;
      }
    }
  }

  #sealedRecord(handover: Handover, closedAt: string) {
    const photos = this.#d.photos.listForHandover(handover.id);
    const marks = this.#d.marks.listForHandover(handover.id).filter((m) => m.source !== 'rejected');
    return {
      version: 1,
      handover: {
        id: handover.id,
        containerNumber: handover.containerNumber,
        direction: handover.direction,
        place: handover.place,
        checker: handover.checker,
        handedOverBy: handover.handedOverBy,
        receivedBy: handover.receivedBy,
        sealNumbers: handover.sealNumbers,
        startedAt: handover.startedAt,
        closedAt,
        previousHandoverId: handover.previousHandoverId,
      },
      photos: photos.map((p) => ({
        id: p.id,
        face: p.face,
        sha256: p.sha256,
        corners: p.corners,
        capturedAt: p.capturedAt,
      })),
      marks: marks.map((m) => ({
        id: m.id,
        face: m.face,
        rect: m.rect,
        outline: m.outline,
        locationCode: m.locationCode,
        damageCode: m.damageCode,
        componentCode: m.componentCode,
        status: m.status,
        source: m.source,
        previousMarkId: m.previousMarkId,
        photoId: m.photoId,
        note: m.note,
      })),
    };
  }

  // Lookups ----------------------------------------------------------------

  #now(): string {
    return this.#d.clock.now().toISOString();
  }

  #container(number: string): Container {
    const parsed = parseContainerNumber(number);
    const container = parsed.ok ? this.#d.containers.get(parsed.value.value) : undefined;
    if (!container) throw new NotFoundError(`Container ${number} is not registered`);
    return container;
  }

  #handover(id: string): Handover {
    const handover = this.#d.handovers.get(id);
    if (!handover) throw new NotFoundError(`Handover ${id} not found`);
    return handover;
  }

  #openHandover(id: string): Handover {
    const handover = this.#handover(id);
    if (handover.status !== 'open') throw new ConflictError(`Handover ${id} is closed`);
    return handover;
  }

  #photo(handoverId: string, photoId: string): Photo {
    const photo = this.#d.photos.get(photoId);
    if (!photo || photo.handoverId !== handoverId) {
      throw new NotFoundError(`Photo ${photoId} not found in handover ${handoverId}`);
    }
    return photo;
  }

  #mark(handoverId: string, markId: string): Mark {
    const mark = this.#d.marks.get(markId);
    if (!mark || mark.handoverId !== handoverId) {
      throw new NotFoundError(`Mark ${markId} not found in handover ${handoverId}`);
    }
    return mark;
  }
}
