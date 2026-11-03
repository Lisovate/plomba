/**
 * The handover workflow: register the container, start a handover against the
 * previous one, collect photos and marks, then seal the record into the
 * container's hash chain.
 */

import {
  type Container,
  type ContainerHistory,
  type ContainerSummary,
  type CreateMark,
  FaceRectSchema,
  FaceSchema,
  type Handover,
  type HandoverDetail,
  type HandoverSearch,
  HandoverSearchSchema,
  HandoverStatusSchema,
  type HandoverSummary,
  type Mark,
  MarkStatusSchema,
  type Photo,
  type RegisterContainer,
  type StartHandover,
  type UpdateMark,
} from '@plomba/contracts';
import {
  buildCodeco,
  chainHash,
  clampToFace,
  DEFAULT_DIMENSIONS,
  damageHistory,
  FACES,
  type Face,
  type FaceCoverage,
  faceCoverage,
  GENESIS_HASH,
  locationCode,
  parseContainerNumber,
  parseSizeType,
  parseWagonNumber,
  type Quad,
  rectOverlap,
  verifyChain,
} from '@plomba/core';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import { blurRegions, normaliseImage } from '../media/images.ts';
import type {
  Clock,
  ContainerRepository,
  DamageDetector,
  EventPublisher,
  HandoverEvent,
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

/** The parts of a sealed record (versions 1 and 2) that the damage history reads. */
const SealedRecordSchema = z.object({
  /** Version 2: CEDEX cells with no photo, by face. */
  notInspected: z.partialRecord(FaceSchema, z.array(z.string())).optional(),
  handover: z.object({ id: z.string() }),
  marks: z.array(
    z.object({
      id: z.string(),
      face: FaceSchema,
      rect: FaceRectSchema,
      locationCode: z.string(),
      damageCode: z.string().nullable(),
      status: MarkStatusSchema,
      previousMarkId: z.string().nullable(),
    }),
  ),
});

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
  /** This installation's ID in EDIFACT messages. */
  readonly ediSenderId: string;
  /** Where handover events go (e.g. webhooks); none by default. */
  readonly events?: EventPublisher;
}

type Coverage = Record<Face, FaceCoverage>;

/** Attempts at sealing when another handover of the same container wins the race. */
const SEAL_ATTEMPTS = 3;

/** Live frames only need the container's outline. */
const LIVE_FRAME_MAX_SIDE = 768;

const HandoverCursorSchema = z.strictObject({
  startedAt: z.iso.datetime({ precision: 3 }),
  id: z.uuid(),
  /** Bare requests keep open handovers first; their cursors also carry that group. */
  status: HandoverStatusSchema.optional(),
});

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
    // Only sealed records count as evidence, and only while the chain holds.
    const sealed = verification.ok
      ? links.map((link) => SealedRecordSchema.parse(JSON.parse(link.record)))
      : [];
    return {
      container,
      handovers: this.#d.handovers.listForContainer(container.number),
      chain: {
        ok: verification.ok,
        length: links.length,
        brokenAt: verification.ok ? null : verification.index,
      },
      damage: damageHistory(
        sealed.map((record) => ({
          id: record.handover.id,
          marks: record.marks,
          ...(record.notInspected ? { notInspected: record.notInspected } : {}),
        })),
        container.dimensions,
      ),
    };
  }

  // Handovers --------------------------------------------------------------

  /**
   * The containers an owner, lessor or operator follows: those whose number
   * starts with `owner` (an owner code such as PLBU, or its three letters),
   * most recently handed over first.
   */
  listContainers(options: { owner?: string | undefined; limit?: number } = {}): ContainerSummary[] {
    const owner = options.owner?.trim().toUpperCase();
    if (owner && !/^[A-Z]{3}[UJZ]?$/.test(owner)) {
      throw new ValidationError(
        'owner must be an owner code: three letters, optionally with U, J or Z',
      );
    }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    return this.#d.containers.list({ ...(owner ? { prefix: owner } : {}), limit });
  }

  start(input: StartHandover): Handover {
    const container = this.#container(input.containerNumber);
    const vehicleId = vehicleIdentifier(input);
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
        transportMode: input.transportMode ?? null,
        vehicleId,
        startedAt: this.#now(),
        previousHandoverId: this.#d.handovers.findLastClosed(container.number)?.id ?? null,
      });
    });
    const handover = this.#handover(id);
    this.#publish('handover.started', handover);
    return handover;
  }

  /** The checker's list: open handovers first, then the most recently started. */
  recent(limit = 30): HandoverSummary[] {
    return this.#d.handovers.search({ limit, openFirst: true });
  }

  search(
    options: HandoverSearch = {},
    order: 'newest' | 'open-first' = 'newest',
  ): {
    handovers: HandoverSummary[];
    nextCursor?: string;
  } {
    const parsed = HandoverSearchSchema.safeParse(options);
    if (!parsed.success) {
      throw new ValidationError('The search parameters are invalid', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const { cursor, limit, ...filters } = parsed.data;
    if (filters.vehicle !== undefined) {
      filters.vehicle = filters.vehicle.toUpperCase().replace(/[ -]/g, '');
      if (!filters.vehicle) {
        throw new ValidationError('vehicle must contain a registration or wagon number', {
          issues: [{ path: 'vehicle', message: 'Expected a registration or wagon number' }],
        });
      }
    }
    if (filters.container !== undefined) {
      const number = parseContainerNumber(filters.container);
      if (!number.ok) {
        throw new ValidationError(`${filters.container} is not a valid ISO 6346 container number`, {
          issues: [{ path: 'container', message: number.error.code }],
        });
      }
      filters.container = number.value.value;
    }
    const after = cursor === undefined ? undefined : decodeHandoverCursor(cursor);
    const openFirst = after ? after.status !== undefined : order === 'open-first';
    const found = this.#d.handovers.search({ ...filters, limit: limit + 1, after, openFirst });
    const handovers = found.slice(0, limit);
    const last = handovers.at(-1);
    return {
      handovers,
      ...(found.length > limit && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                startedAt: last.startedAt,
                id: last.id,
                ...(openFirst ? { status: last.status } : {}),
              }),
            ).toString('base64url'),
          }
        : {}),
    };
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

  /**
   * Finds the face in a live camera frame so the app can draw the previous
   * handover's marks over the preview. Nothing is stored.
   */
  async registerFrame(
    handoverId: string,
    frame: Uint8Array,
  ): Promise<{ width: number; height: number; corners: Quad | null }> {
    this.#openHandover(handoverId);
    const image = await normaliseImage(frame, LIVE_FRAME_MAX_SIDE);
    const corners = await detectFaceCorners(this.#d.segmenter, image);
    return { width: image.width, height: image.height, corners };
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
  async close(handoverId: string, options: { acceptGaps?: boolean } = {}): Promise<Handover> {
    for (let attempt = 1; ; attempt++) {
      const handover = this.#openHandover(handoverId);
      if (this.#d.marks.listForHandover(handoverId).some((m) => m.source === 'proposed')) {
        throw new ConflictError('Confirm or reject the proposed damage before sealing');
      }
      const coverage = this.#coverage(handover);
      const gaps = Object.entries(coverage).filter(([, c]) => c.missing.length > 0);
      if (gaps.length > 0 && !options.acceptGaps) {
        throw new ConflictError('Some sections of the container have no photo', {
          issues: gaps.map(([face, c]) => ({
            path: `coverage.${face}`,
            message: `${c.missing.length} of ${c.total} sections missing`,
          })),
        });
      }
      const closedAt = this.#now();
      const record = this.#sealedRecord(handover, closedAt, coverage);
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
        const sealed = this.#handover(handoverId);
        this.#publish('handover.sealed', sealed);
        return sealed;
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt >= SEAL_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * The EDIFACT CODECO gate report for a sealed handover. It lists the damage
   * still present on the container and carries the sealed record's hash.
   */
  codeco(handoverId: string, recipientId: string): { fileName: string; content: string } {
    const handover = this.#handover(handoverId);
    if (!handover.seal) throw new ConflictError('Seal the handover before sending a gate report');
    const container = this.#container(handover.containerNumber);
    const damages = this.#d.marks
      .listForHandover(handoverId)
      .filter((m) => m.source === 'confirmed' && m.status !== 'repaired' && m.damageCode)
      .map((m) => ({
        locationCode: m.locationCode,
        damageCode: m.damageCode ?? '',
        componentCode: m.componentCode,
      }));
    const documentNumber = `${container.number}-${handover.seal.sequence + 1}`;
    const content = buildCodeco({
      senderId: this.#d.ediSenderId,
      recipientId,
      interchangeRef: handover.seal.hash.slice(0, 14).toUpperCase(),
      documentNumber,
      preparedAt: this.#d.clock.now(),
      direction: handover.direction,
      containerNumber: container.number,
      sizeTypeCode: container.sizeTypeCode,
      movedAt: new Date(handover.startedAt),
      place: { name: handover.place },
      sealNumbers: handover.sealNumbers,
      damages,
      recordHash: handover.seal.hash,
      ...(handover.transportMode
        ? {
            inlandTransport: {
              mode: handover.transportMode,
              ...(handover.vehicleId ? { reference: handover.vehicleId } : {}),
            },
          }
        : {}),
    });
    return { fileName: `CODECO-${documentNumber}.edi`, content };
  }

  /** Which CEDEX sections of each face have photographic evidence. */
  #coverage(handover: Handover): Coverage {
    const { dimensions } = this.#container(handover.containerNumber);
    const photos = this.#d.photos.listForHandover(handover.id);
    return Object.fromEntries(
      FACES.map((face) => [
        face,
        faceCoverage(
          face,
          dimensions,
          photos.filter((p) => p.face === face),
        ),
      ]),
    ) as Coverage;
  }

  #sealedRecord(handover: Handover, closedAt: string, coverage: Coverage) {
    const photos = this.#d.photos.listForHandover(handover.id);
    const marks = this.#d.marks.listForHandover(handover.id).filter((m) => m.source !== 'rejected');
    return {
      version: 2,
      // Sections without a photo were not inspected, and the record says so.
      notInspected: Object.fromEntries(
        Object.entries(coverage).flatMap(([face, c]) =>
          c.missing.length > 0 ? [[face, c.missing]] : [],
        ),
      ),
      handover: {
        id: handover.id,
        containerNumber: handover.containerNumber,
        direction: handover.direction,
        place: handover.place,
        checker: handover.checker,
        handedOverBy: handover.handedOverBy,
        receivedBy: handover.receivedBy,
        sealNumbers: handover.sealNumbers,
        transportMode: handover.transportMode,
        vehicleId: handover.vehicleId,
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

  #publish(type: HandoverEvent['type'], handover: Handover): void {
    this.#d.events?.publish({
      type,
      handoverId: handover.id,
      containerNumber: handover.containerNumber,
      occurredAt: this.#now(),
    });
  }

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

/** A truck registration in capitals, or a wagon number that passes the UIC check digit. */
function vehicleIdentifier(input: StartHandover): string | null {
  const raw = input.vehicleId?.trim();
  if (!raw) return null;
  if (input.transportMode !== 'rail') return raw.toUpperCase();
  const wagon = parseWagonNumber(raw);
  if (!wagon.ok) {
    throw new ValidationError(`${raw} is not a valid UIC wagon number`, {
      issues: [
        {
          path: 'vehicleId',
          message:
            wagon.expected === undefined
              ? 'expected 12 digits'
              : `the check digit should be ${wagon.expected}`,
        },
      ],
    });
  }
  return wagon.value;
}

function decodeHandoverCursor(cursor: string): z.infer<typeof HandoverCursorSchema> {
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor) throw new Error('Invalid base64url');
    return HandoverCursorSchema.parse(JSON.parse(decoded.toString('utf8')));
  } catch {
    throw new ValidationError('The handover cursor is invalid', {
      issues: [{ path: 'cursor', message: 'Use the cursor from the next-page Link header' }],
    });
  }
}
