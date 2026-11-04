/**
 * Sample footage and photos for trying Plomba without a container nearby.
 * Only files named and credited in samples.json are ever served.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Sample, SampleContainerNumberSchema, SampleUseSchema } from '@plomba/contracts';
import { z } from 'zod';
import { ConfigError } from '../config.ts';

const ManifestSchema = z
  .array(
    z
      .object({
        /** A file name in the folder: letters, digits, dots, dashes and underscores only. */
        file: z.string().regex(/^[\w.-]+\.(mp4|mov|jpe?g)$/i),
        title: z.string().min(1).max(120),
        /** Who made it and under which licence. */
        credit: z.string().min(1).max(300),
        sourceUrl: z.url().nullable().default(null),
        containerNumber: SampleContainerNumberSchema.nullable().default(null),
        use: SampleUseSchema.nullable().default(null),
      })
      .refine(
        (entry) => (/\.jpe?g$/i.test(entry.file) ? entry.use !== null : entry.use === null),
        'Photos need a use (doors, D, R, F, L or T); clips cannot have one',
      ),
  )
  .refine(
    (entries) => new Set(entries.map((e) => e.file)).size === entries.length,
    'Each sample file must be listed only once',
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
      throw new ConfigError(`${manifest} is missing or not a valid list of samples`, {
        cause,
      });
    }
    return new SampleClips(
      dir,
      entries.filter((entry) => {
        const file = join(dir, entry.file);
        if (!existsSync(file)) return false;
        // A listed symlink must not expose files outside the samples folder.
        if (!lstatSync(file).isFile()) throw new ConfigError(`${file} must be a regular file`);
        return true;
      }),
    );
  }

  list(): Sample[] {
    return [...this.#entries.values()].map(
      ({ file, title, credit, sourceUrl, containerNumber, use }) => ({
        title,
        credit,
        sourceUrl,
        url: `/api/samples/${encodeURIComponent(file)}`,
        containerNumber,
        ...(/\.jpe?g$/i.test(file)
          ? { kind: 'photo' as const, use: use as NonNullable<Entry['use']> }
          : { kind: 'clip' as const, use: null }),
      }),
    );
  }

  /** The sample's bytes and type, or `null` for anything not listed. */
  async read(file: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
    if (!this.#entries.has(file)) return null;
    const data = new Uint8Array(await readFile(join(this.#dir, file)));
    return {
      data,
      mimeType: /\.jpe?g$/i.test(file)
        ? 'image/jpeg'
        : /\.mov$/i.test(file)
          ? 'video/quicktime'
          : 'video/mp4',
    };
  }
}
