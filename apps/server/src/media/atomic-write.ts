import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/**
 * Writes a file under a unique temporary name, then renames it into place, so
 * a crash never leaves a partial file under the final name, and two writes of
 * the same file at once (the same photo uploaded twice, the same clip tracked
 * twice) never share a temporary file.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
