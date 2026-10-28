/**
 * Ports: what the services need from the outside world. Adapters implement
 * them (Meta Model API, SQLite, the filesystem); tests use in-memory fakes.
 */

import type {
  Container,
  Handover,
  HandoverSummary,
  Mark,
  MarkingsRead,
  MarkSource,
  MarkStatus,
  Photo,
} from '@plomba/contracts';
import type { Face, FaceRect, Quad } from '@plomba/core';

// Models -------------------------------------------------------------------

export interface ImageInput {
  readonly data: Uint8Array;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** Reads container markings from a photo (Muse Spark). */
export interface MarkingsReader {
  read(image: ImageInput): Promise<MarkingsRead>;
  /**
   * Given several valid container numbers that differ by look-alike characters,
   * picks the one painted in the photo, or `null` if none clearly matches.
   */
  chooseNumber(
    image: ImageInput,
    candidates: readonly string[],
  ): Promise<{ readonly choice: string | null; readonly reason: string }>;
}

/** A box in image pixels; `right` and `bottom` are exclusive. */
export interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface SegmentedObject {
  /** Bounding box in source image pixels. */
  readonly box: PixelBox;
  /** 0–1, when the model reports it. */
  readonly confidence: number | undefined;
  /** Binary mask (row-major, 1 = object), possibly at a lower resolution than the photo. */
  readonly mask: {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
    /** Where the mask sits in the photo, in source pixels. */
    readonly bounds: PixelBox;
  };
}

/** Finds every instance of a concept in a photo (SAM 3.1). */
export interface Segmenter {
  segment(image: ImageInput, concept: string): Promise<SegmentedObject[]>;
}

// Storage ------------------------------------------------------------------

export interface StoredMedia {
  /** SHA-256 of the stored bytes, hex. Also the storage key. */
  readonly sha256: string;
  readonly size: number;
}

export interface MediaStore {
  put(data: Uint8Array): Promise<StoredMedia>;
  get(sha256: string): Promise<Uint8Array | undefined>;
}

// Persistence --------------------------------------------------------------

export interface ContainerRepository {
  get(number: string): Container | undefined;
  insert(container: Container): void;
  updateSizeType(number: string, sizeTypeCode: string, dimensions: Container['dimensions']): void;
}

export interface NewHandover {
  readonly id: string;
  readonly containerNumber: string;
  readonly direction: Handover['direction'];
  readonly place: string;
  readonly checker: string;
  readonly handedOverBy: string | null;
  readonly receivedBy: string | null;
  readonly sealNumbers: readonly string[];
  readonly startedAt: string;
  readonly previousHandoverId: string | null;
}

export interface SealedRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly hash: string;
  /** The canonical JSON that was hashed. */
  readonly record: string;
  readonly closedAt: string;
}

export interface ChainLink {
  readonly sequence: number;
  readonly previousHash: string;
  readonly hash: string;
  readonly record: string;
}

export interface HandoverRepository {
  get(id: string): Handover | undefined;
  insert(handover: NewHandover): void;
  findOpen(containerNumber: string): Handover | undefined;
  /** The most recent closed handover of a container. */
  findLastClosed(containerNumber: string): Handover | undefined;
  listForContainer(containerNumber: string): Handover[];
  /** Open handovers first, then the most recently started; with photo and mark counts. */
  listRecent(limit: number): HandoverSummary[];
  /** The container's sealed records, oldest first. */
  chain(containerNumber: string): ChainLink[];
  /** Marks the handover closed and appends it to the chain. Throws `ConflictError` if the sequence is taken. */
  seal(id: string, sealed: SealedRecord): void;
}

export interface NewPhoto {
  readonly id: string;
  readonly handoverId: string;
  readonly face: Face;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly corners: Quad | null;
  readonly cornersSource: Photo['cornersSource'];
  readonly redactedRegions: number;
  readonly capturedAt: string;
}

export interface PhotoRepository {
  get(id: string): Photo | undefined;
  insert(photo: NewPhoto): void;
  listForHandover(handoverId: string): Photo[];
  updateCorners(id: string, corners: Quad, source: 'detected' | 'adjusted'): void;
}

export interface NewMark {
  readonly id: string;
  readonly handoverId: string;
  readonly face: Face;
  readonly rect: FaceRect;
  readonly locationCode: string;
  readonly damageCode: string | null;
  readonly componentCode: string | null;
  readonly status: MarkStatus;
  readonly source: MarkSource;
  readonly previousMarkId: string | null;
  readonly photoId: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface MarkRepository {
  get(id: string): Mark | undefined;
  insert(mark: NewMark): void;
  update(mark: Mark): void;
  listForHandover(handoverId: string): Mark[];
}

/** Runs a function atomically. Repositories called inside share the transaction. */
export type TransactionRunner = <T>(fn: () => T) => T;

export interface Clock {
  now(): Date;
}

export type IdGenerator = () => string;
