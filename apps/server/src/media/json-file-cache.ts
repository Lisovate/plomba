import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResultCache } from '../ports.ts';
import { writeFileAtomic } from './atomic-write.ts';

const KEY = /^[0-9a-f]{64}$/;

/** A cache of JSON results on disk, one file per SHA-256 key. */
export class JsonFileCache<T> implements ResultCache<T> {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async get(key: string): Promise<T | undefined> {
    if (!KEY.test(key)) return undefined;
    try {
      return JSON.parse(await readFile(join(this.#root, `${key}.json`), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async put(key: string, value: T): Promise<void> {
    if (!KEY.test(key)) throw new RangeError('Cache keys are SHA-256 hex digests');
    await mkdir(this.#root, { recursive: true });
    await writeFileAtomic(join(this.#root, `${key}.json`), JSON.stringify(value));
  }
}
