/**
 * Schema migrations, applied in order. Never edit a released migration; add a
 * new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE containers (
    number          TEXT PRIMARY KEY,
    size_type_code  TEXT,
    length_m        REAL NOT NULL,
    width_m         REAL NOT NULL,
    height_m        REAL NOT NULL,
    created_at      TEXT NOT NULL
  ) STRICT;

  CREATE TABLE handovers (
    id                    TEXT PRIMARY KEY,
    container_number      TEXT NOT NULL REFERENCES containers(number),
    direction             TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    place                 TEXT NOT NULL,
    checker               TEXT NOT NULL,
    handed_over_by        TEXT,
    received_by           TEXT,
    seal_numbers          TEXT NOT NULL DEFAULT '[]',
    status                TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    started_at            TEXT NOT NULL,
    closed_at             TEXT,
    previous_handover_id  TEXT REFERENCES handovers(id),
    -- The container's hash chain: set once, when the handover is sealed.
    sequence              INTEGER,
    previous_hash         TEXT,
    hash                  TEXT,
    record                TEXT,
    CHECK ((status = 'open') = (hash IS NULL))
  ) STRICT;

  CREATE UNIQUE INDEX handovers_one_open_per_container
    ON handovers(container_number) WHERE status = 'open';
  CREATE UNIQUE INDEX handovers_chain_order
    ON handovers(container_number, sequence) WHERE sequence IS NOT NULL;
  CREATE INDEX handovers_by_container ON handovers(container_number, started_at);

  CREATE TABLE photos (
    id                TEXT PRIMARY KEY,
    handover_id       TEXT NOT NULL REFERENCES handovers(id),
    face              TEXT NOT NULL CHECK (face IN ('D', 'R', 'F', 'L', 'T')),
    sha256            TEXT NOT NULL,
    width             INTEGER NOT NULL,
    height            INTEGER NOT NULL,
    corners           TEXT,
    corners_source    TEXT CHECK (corners_source IN ('detected', 'adjusted')),
    redacted_regions  INTEGER NOT NULL DEFAULT 0,
    captured_at       TEXT NOT NULL
  ) STRICT;

  CREATE INDEX photos_by_handover ON photos(handover_id, captured_at);

  CREATE TABLE marks (
    id                TEXT PRIMARY KEY,
    handover_id       TEXT NOT NULL REFERENCES handovers(id),
    face              TEXT NOT NULL CHECK (face IN ('D', 'R', 'F', 'L', 'T')),
    u0                REAL NOT NULL,
    v0                REAL NOT NULL,
    u1                REAL NOT NULL,
    v1                REAL NOT NULL,
    location_code     TEXT NOT NULL,
    damage_code       TEXT,
    component_code    TEXT,
    status            TEXT NOT NULL CHECK (status IN ('new', 'still-there', 'changed', 'repaired')),
    source            TEXT NOT NULL CHECK (source IN ('proposed', 'confirmed', 'rejected')),
    previous_mark_id  TEXT REFERENCES marks(id),
    photo_id          TEXT REFERENCES photos(id),
    note              TEXT,
    created_at        TEXT NOT NULL
  ) STRICT;

  CREATE INDEX marks_by_handover ON marks(handover_id, created_at);
  `,
  // 2026-10-28: damage outlines traced by SAM 3.1, as JSON [{x, y}] in metres on the face.
  `
  ALTER TABLE marks ADD COLUMN outline TEXT;
  `,
];
