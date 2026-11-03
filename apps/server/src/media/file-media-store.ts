import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MediaStore, StoredMedia } from '../ports.ts';
import { writeFileAtomic } from './atomic-write.ts';

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Content-addressed media on the local filesystem: a file's name is the
 * SHA-256 of its bytes, so the hash in a sealed handover record identifies the
 * exact photo, and a changed file no longer matches its name.
 */
export class FileMediaStore implements MediaStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async put(data: Uint8Array): Promise<StoredMedia> {
    const sha256 = createHash('sha256').update(data).digest('hex');
    const path = this.#path(sha256);
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, data);
    return { sha256, size: data.byteLength };
  }

  async get(sha256: string): Promise<Uint8Array | undefined> {
    if (!SHA256.test(sha256)) return undefined;
    try {
      return new Uint8Array(await readFile(this.#path(sha256)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  #path(sha256: string): string {
    return join(this.#root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }
}
