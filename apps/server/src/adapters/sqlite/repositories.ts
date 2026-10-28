/**
 * SQLite implementations of the repository ports. Rows are mapped to the API
 * types at this boundary, so nothing above it sees snake_case or JSON columns.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Container, Handover, HandoverSummary, Mark, Photo } from '@plomba/contracts';
import type { Face, Quad } from '@plomba/core';
import { ConflictError } from '../../errors.ts';
import type {
  ChainLink,
  ContainerRepository,
  HandoverRepository,
  MarkRepository,
  NewHandover,
  NewMark,
  NewPhoto,
  PhotoRepository,
  SealedRecord,
} from '../../ports.ts';
import { isUniqueViolation } from './database.ts';

type Row = Record<string, unknown>;

const str = (row: Row, key: string) => row[key] as string;
const strOrNull = (row: Row, key: string) => (row[key] ?? null) as string | null;
const num = (row: Row, key: string) => row[key] as number;
const parseJsonOrNull = <T>(value: string | null): T | null =>
  value === null ? null : (JSON.parse(value) as T);

export class SqliteContainerRepository implements ContainerRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  get(number: string): Container | undefined {
    const row = this.#db.prepare('SELECT * FROM containers WHERE number = ?').get(number) as
      | Row
      | undefined;
    return (
      row && {
        number: str(row, 'number'),
        sizeTypeCode: strOrNull(row, 'size_type_code'),
        dimensions: {
          length: num(row, 'length_m'),
          width: num(row, 'width_m'),
          height: num(row, 'height_m'),
        },
        createdAt: str(row, 'created_at'),
      }
    );
  }

  insert(container: Container): void {
    this.#db
      .prepare(
        `INSERT INTO containers (number, size_type_code, length_m, width_m, height_m, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        container.number,
        container.sizeTypeCode,
        container.dimensions.length,
        container.dimensions.width,
        container.dimensions.height,
        container.createdAt,
      );
  }

  updateSizeType(number: string, sizeTypeCode: string, dimensions: Container['dimensions']): void {
    this.#db
      .prepare(
        `UPDATE containers SET size_type_code = ?, length_m = ?, width_m = ?, height_m = ?
         WHERE number = ?`,
      )
      .run(sizeTypeCode, dimensions.length, dimensions.width, dimensions.height, number);
  }
}

function toHandover(row: Row): Handover {
  const hash = strOrNull(row, 'hash');
  return {
    id: str(row, 'id'),
    containerNumber: str(row, 'container_number'),
    direction: str(row, 'direction') as Handover['direction'],
    place: str(row, 'place'),
    checker: str(row, 'checker'),
    handedOverBy: strOrNull(row, 'handed_over_by'),
    receivedBy: strOrNull(row, 'received_by'),
    sealNumbers: JSON.parse(str(row, 'seal_numbers')) as string[],
    status: str(row, 'status') as Handover['status'],
    startedAt: str(row, 'started_at'),
    closedAt: strOrNull(row, 'closed_at'),
    previousHandoverId: strOrNull(row, 'previous_handover_id'),
    seal:
      hash === null
        ? null
        : { sequence: num(row, 'sequence'), previousHash: str(row, 'previous_hash'), hash },
  };
}

export class SqliteHandoverRepository implements HandoverRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  get(id: string): Handover | undefined {
    const row = this.#db.prepare('SELECT * FROM handovers WHERE id = ?').get(id) as Row | undefined;
    return row && toHandover(row);
  }

  insert(h: NewHandover): void {
    try {
      this.#db
        .prepare(
          `INSERT INTO handovers (id, container_number, direction, place, checker, handed_over_by,
             received_by, seal_numbers, status, started_at, previous_handover_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        )
        .run(
          h.id,
          h.containerNumber,
          h.direction,
          h.place,
          h.checker,
          h.handedOverBy,
          h.receivedBy,
          JSON.stringify(h.sealNumbers),
          h.startedAt,
          h.previousHandoverId,
        );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Container ${h.containerNumber} already has an open handover`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  findOpen(containerNumber: string): Handover | undefined {
    const row = this.#db
      .prepare(`SELECT * FROM handovers WHERE container_number = ? AND status = 'open'`)
      .get(containerNumber) as Row | undefined;
    return row && toHandover(row);
  }

  findLastClosed(containerNumber: string): Handover | undefined {
    const row = this.#db
      .prepare(
        `SELECT * FROM handovers WHERE container_number = ? AND status = 'closed'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(containerNumber) as Row | undefined;
    return row && toHandover(row);
  }

  listForContainer(containerNumber: string): Handover[] {
    return (
      this.#db
        .prepare('SELECT * FROM handovers WHERE container_number = ? ORDER BY started_at DESC')
        .all(containerNumber) as Row[]
    ).map(toHandover);
  }

  listRecent(limit: number): HandoverSummary[] {
    return (
      this.#db
        .prepare(
          `SELECT h.*,
             (SELECT count(*) FROM marks m WHERE m.handover_id = h.id AND m.source != 'rejected') AS mark_count,
             (SELECT count(*) FROM photos p WHERE p.handover_id = h.id) AS photo_count
           FROM handovers h
           ORDER BY h.status = 'open' DESC, h.started_at DESC
           LIMIT ?`,
        )
        .all(limit) as Row[]
    ).map((row) => ({
      ...toHandover(row),
      markCount: num(row, 'mark_count'),
      photoCount: num(row, 'photo_count'),
    }));
  }

  chain(containerNumber: string): ChainLink[] {
    return (
      this.#db
        .prepare(
          `SELECT sequence, previous_hash, hash, record FROM handovers
           WHERE container_number = ? AND sequence IS NOT NULL ORDER BY sequence`,
        )
        .all(containerNumber) as Row[]
    ).map((row) => ({
      sequence: num(row, 'sequence'),
      previousHash: str(row, 'previous_hash'),
      hash: str(row, 'hash'),
      record: str(row, 'record'),
    }));
  }

  seal(id: string, sealed: SealedRecord): void {
    try {
      const result = this.#db
        .prepare(
          `UPDATE handovers
           SET status = 'closed', closed_at = ?, sequence = ?, previous_hash = ?, hash = ?, record = ?
           WHERE id = ? AND status = 'open'`,
        )
        .run(sealed.closedAt, sealed.sequence, sealed.previousHash, sealed.hash, sealed.record, id);
      if (result.changes !== 1) throw new ConflictError(`Handover ${id} is not open`);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Another handover of this container was sealed at the same time', {
          cause: error,
        });
      }
      throw error;
    }
  }
}

function toPhoto(row: Row): Photo {
  const sha256 = str(row, 'sha256');
  const corners = strOrNull(row, 'corners');
  return {
    id: str(row, 'id'),
    handoverId: str(row, 'handover_id'),
    face: str(row, 'face') as Face,
    url: `/media/${sha256}`,
    sha256,
    width: num(row, 'width'),
    height: num(row, 'height'),
    corners: parseJsonOrNull<Photo['corners']>(corners),
    cornersSource: strOrNull(row, 'corners_source') as Photo['cornersSource'],
    redactedRegions: num(row, 'redacted_regions'),
    capturedAt: str(row, 'captured_at'),
  };
}

export class SqlitePhotoRepository implements PhotoRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  get(id: string): Photo | undefined {
    const row = this.#db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as Row | undefined;
    return row && toPhoto(row);
  }

  insert(p: NewPhoto): void {
    this.#db
      .prepare(
        `INSERT INTO photos (id, handover_id, face, sha256, width, height, corners, corners_source,
           redacted_regions, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.handoverId,
        p.face,
        p.sha256,
        p.width,
        p.height,
        p.corners && JSON.stringify(p.corners),
        p.cornersSource,
        p.redactedRegions,
        p.capturedAt,
      );
  }

  listForHandover(handoverId: string): Photo[] {
    return (
      this.#db
        .prepare('SELECT * FROM photos WHERE handover_id = ? ORDER BY captured_at')
        .all(handoverId) as Row[]
    ).map(toPhoto);
  }

  updateCorners(id: string, corners: Quad, source: 'detected' | 'adjusted'): void {
    this.#db
      .prepare('UPDATE photos SET corners = ?, corners_source = ? WHERE id = ?')
      .run(JSON.stringify(corners), source, id);
  }
}

function toMark(row: Row): Mark {
  return {
    id: str(row, 'id'),
    handoverId: str(row, 'handover_id'),
    face: str(row, 'face') as Face,
    rect: { u0: num(row, 'u0'), v0: num(row, 'v0'), u1: num(row, 'u1'), v1: num(row, 'v1') },
    outline: parseJsonOrNull<Mark['outline']>(strOrNull(row, 'outline')),
    locationCode: str(row, 'location_code'),
    damageCode: strOrNull(row, 'damage_code') as Mark['damageCode'],
    componentCode: strOrNull(row, 'component_code') as Mark['componentCode'],
    status: str(row, 'status') as Mark['status'],
    source: str(row, 'source') as Mark['source'],
    previousMarkId: strOrNull(row, 'previous_mark_id'),
    photoId: strOrNull(row, 'photo_id'),
    note: strOrNull(row, 'note'),
    createdAt: str(row, 'created_at'),
  };
}

export class SqliteMarkRepository implements MarkRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  get(id: string): Mark | undefined {
    const row = this.#db.prepare('SELECT * FROM marks WHERE id = ?').get(id) as Row | undefined;
    return row && toMark(row);
  }

  insert(m: NewMark): void {
    this.#db
      .prepare(
        `INSERT INTO marks (id, handover_id, face, u0, v0, u1, v1, outline, location_code,
           damage_code, component_code, status, source, previous_mark_id, photo_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.handoverId,
        m.face,
        m.rect.u0,
        m.rect.v0,
        m.rect.u1,
        m.rect.v1,
        m.outline && JSON.stringify(m.outline),
        m.locationCode,
        m.damageCode,
        m.componentCode,
        m.status,
        m.source,
        m.previousMarkId,
        m.photoId,
        m.note,
        m.createdAt,
      );
  }

  update(m: Mark): void {
    this.#db
      .prepare(
        `UPDATE marks SET u0 = ?, v0 = ?, u1 = ?, v1 = ?, outline = ?, location_code = ?,
           damage_code = ?, component_code = ?, status = ?, source = ?, note = ?
         WHERE id = ?`,
      )
      .run(
        m.rect.u0,
        m.rect.v0,
        m.rect.u1,
        m.rect.v1,
        m.outline && JSON.stringify(m.outline),
        m.locationCode,
        m.damageCode,
        m.componentCode,
        m.status,
        m.source,
        m.note,
        m.id,
      );
  }

  listForHandover(handoverId: string): Mark[] {
    return (
      this.#db
        .prepare('SELECT * FROM marks WHERE handover_id = ? ORDER BY created_at')
        .all(handoverId) as Row[]
    ).map(toMark);
  }
}
