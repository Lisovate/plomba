/**
 * Sample walk-around clips an installation can offer, so people trying
 * Plomba without footage of their own can run a walk-around. The operator
 * puts MP4 or MOV files in a folder with a `samples.json` that names each
 * clip and credits it; only clips listed there are ever served.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SampleClip } from '@plomba/contracts';
import { z } from 'zod';
import { ConfigError } from '../config.ts';

const ManifestSchema = z.array(
  z.object({
    /** A file name in the folder: letters, digits, dots, dashes and underscores only. */
    file: z.string().regex(/^[\w.-]+\.(mp4|mov)$/i),
    title: z.string().min(1).max(120),
    /** Who made it and under which licence. */
    credit: z.string().min(1).max(300),
    sourceUrl: z.url().nullable().default(null),
  }),
);

type Entry = z.infer<typeof ManifestSchema>[number];

export class SampleClips {
  readonly #dir: string;
  readonly #entries: ReadonlyMap<string, Entry>;

  private constructor(dir: string, entries: readonly Entry[]) {
    this.#dir = dir;
    this.#entries = new Map(entries.map((entry) => [entry.file, entry]));
  }

  /** Reads `samples.json` once, at startup; listed files that don't exist are left out. */
  static load(dir: string): SampleClips {
    const manifest = join(dir, 'samples.json');
    let entries: Entry[];
    try {
      entries = ManifestSchema.parse(JSON.parse(readFileSync(manifest, 'utf8')));
    } catch (cause) {
      throw new ConfigError(`${manifest} is missing or not a valid list of sample clips`, {
        cause,
      });
    }
    return new SampleClips(
      dir,
      entries.filter((entry) => existsSync(join(dir, entry.file))),
    );
  }

  list(): SampleClip[] {
    return [...this.#entries.values()].map(({ file, title, credit, sourceUrl }) => ({
      title,
      credit,
      sourceUrl,
      url: `/api/samples/${encodeURIComponent(file)}`,
    }));
  }

  /** The clip's bytes and type, or `null` for anything not listed. */
  async read(file: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
    if (!this.#entries.has(file)) return null;
    const data = new Uint8Array(await readFile(join(this.#dir, file)));
    return {
      data,
      mimeType: file.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
    };
  }
}
